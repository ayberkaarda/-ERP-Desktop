<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Sync;

use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\WriteOutcome;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Http\Requests\CountsRequest;
use App\Modules\Inventory\Http\Requests\StockDocumentRequest;
use App\Modules\Inventory\Http\Resources\StockDocumentResource;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Services\StockDocuments;
use BackedEnum;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Write side of `stock-documents`: offline writes are count documents only (create, update,
 * delete and the `counts` action). Each operation replays the REST chain: the module's own
 * FormRequest (rules and permission) on a synthetic request, the Gate, then StockDocuments.
 * Posting, import and reversal are online-only and have no writer here.
 *
 * Count-only is enforced three times: the Sync module checks `payload_constraints` on the
 * payload and `target_constraints` on the stored row (targetSatisfies), and this writer refuses
 * the same cases on its own, so an adapter call can never widen what may be edited offline.
 */
final class StockDocumentSyncWriter implements SyncWriter
{
    private const string BASE = '/api/v1/stock-documents';

    /** @var array<string, list<string>> */
    private const array COUNT_ONLY = ['doc_type' => [DocumentType::Count->value]];

    public function __construct(private readonly StockDocuments $documents) {}

    public function resource(): string
    {
        return StockDocumentSyncResource::NAME;
    }

    public function find(string $id): ?Model
    {
        return StockDocument::query()->find($id);
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof StockDocument ? $target->currentVersion() : 0;
    }

    public function isDraft(Model $target): bool
    {
        return $target instanceof StockDocument && $target->isDraft();
    }

    /**
     * Every constraint field must hold one of the allowed values (or the single value given).
     */
    public function targetSatisfies(Model $target, array $constraints): bool
    {
        foreach ($constraints as $field => $allowed) {
            $actual = $target->getAttribute($field);
            $actual = $actual instanceof BackedEnum ? $actual->value : $actual;

            if (! in_array($actual, is_array($allowed) ? $allowed : [$allowed], true)) {
                return false;
            }
        }

        return true;
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        if (($mutation->payload['doc_type'] ?? null) !== DocumentType::Count->value) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        try {
            $data = $this->validated(StockDocumentRequest::class, 'POST', self::BASE, [...$mutation->payload, 'id' => $mutation->id], $user);
            $actor = $user->getAuthIdentifier();
            $doc = $this->documents->create($data, is_string($actor) ? $actor : null);

            return $this->applied($doc);
        } catch (ValidationException|AuthorizationException|ApiException $e) {
            return $this->rejected($e);
        }
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        if (! $target instanceof StockDocument || ! $this->countOnly($target, $mutation->payload)) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        try {
            $data = $this->validated(StockDocumentRequest::class, 'PATCH', self::BASE."/{$target->id}", [...$mutation->payload, 'version' => $version], $user);
            Gate::authorize('update', $target);
            $doc = $this->documents->update($target, array_diff_key($data, ['version' => true]), $version);

            return $this->applied($doc);
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        } catch (ValidationException|AuthorizationException|ApiException $e) {
            return $this->rejected($e, $target, $mutation);
        }
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        if (! $target instanceof StockDocument || ! $this->targetSatisfies($target, self::COUNT_ONLY)) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        try {
            Gate::authorize('delete', StockDocument::class);
            Gate::authorize('delete', $target);
            $this->documents->delete($target, $version);

            return WriteOutcome::deleted();
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        } catch (ValidationException|AuthorizationException|ApiException $e) {
            return $this->rejected($e, $target, $mutation);
        }
    }

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        if ($mutation->action !== 'counts' || ! $target instanceof StockDocument || ! $this->targetSatisfies($target, self::COUNT_ONLY)) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        try {
            $data = $this->validated(CountsRequest::class, 'PATCH', self::BASE."/{$target->id}/counts", [...$mutation->payload, 'version' => $version], $user);
            Gate::authorize('update', $target);
            /** @var list<array<string, mixed>> $counts */
            $counts = array_values((array) ($data['counts'] ?? []));
            /** @var list<array<string, mixed>> $add */
            $add = array_values((array) ($data['add'] ?? []));
            $doc = $this->documents->counts($target, $version, $counts, $add);

            return $this->applied($doc);
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        } catch (ValidationException|AuthorizationException|ApiException $e) {
            return $this->rejected($e, $target, $mutation);
        }
    }

    /** The document status is the posting workflow's; the number follows from it. */
    public function lockedFields(): array
    {
        return ['status', 'number'];
    }

    public function auditFields(): array
    {
        return StockDocument::FIELDS;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function countOnly(StockDocument $target, array $payload): bool
    {
        return $this->targetSatisfies($target, self::COUNT_ONLY)
            && (! array_key_exists('doc_type', $payload) || $payload['doc_type'] === DocumentType::Count->value);
    }

    /**
     * Runs the module's FormRequest on a synthetic request: rules, then its permission check.
     *
     * @param  class-string<FormRequest>  $form
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     *
     * @throws ValidationException
     * @throws AuthorizationException
     */
    private function validated(string $form, string $method, string $uri, array $payload, Authenticatable $user): array
    {
        $request = Request::create($uri, $method, $payload);
        $request->setUserResolver(static fn (): Authenticatable => $user);

        $formRequest = $form::createFrom($request);
        $formRequest->setContainer(app())->setRedirector(app(Redirector::class));
        $formRequest->validateResolved();

        /** @var array<string, mixed> */
        return $formRequest->validated();
    }

    private function applied(StockDocument $doc): WriteOutcome
    {
        /** @var array<string, mixed> $data */
        $data = (new StockDocumentResource($doc->load('lines')))->resolve(new Request);

        return WriteOutcome::applied($doc->currentVersion(), $data);
    }

    private function rejected(ValidationException|AuthorizationException|ApiException $e, ?StockDocument $target = null, ?Mutation $mutation = null): WriteOutcome
    {
        if ($e instanceof ValidationException) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $this->fields($e));
        }

        if ($e instanceof AuthorizationException) {
            return WriteOutcome::rejected(ErrorCode::Forbidden);
        }

        // The document left draft between the Sync module's check and the service's row lock.
        if ($e->errorCode === ErrorCode::DocumentLocked && $target !== null) {
            $fresh = StockDocument::query()->with('lines')->find($target->id) ?? $target;
            /** @var array<string, mixed> $server */
            $server = (new StockDocumentResource($fresh))->resolve(new Request);

            return WriteOutcome::conflict(SyncConflict::documentLocked($mutation?->baseVersion, $fresh->currentVersion(), $server));
        }

        return WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
    }

    /**
     * @return array<string, list<string>>
     */
    private function fields(ValidationException $e): array
    {
        $fields = [];

        foreach ($e->errors() as $field => $messages) {
            $fields[$field] = array_values(array_map('strval', $messages));
        }

        return $fields;
    }
}
