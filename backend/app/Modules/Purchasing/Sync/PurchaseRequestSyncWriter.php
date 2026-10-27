<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Sync;

use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\TargetConstraints;
use App\Core\Sync\WriteOutcome;
use App\Modules\Purchasing\Enums\RequestStatus;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Http\Resources\RequestResource;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Services\RequestService;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Write side of `purchase-requests`: create, update and delete of draft requests. It replays the
 * REST chain of RequestController: the same DocumentRequest rules (form `request`, client id on
 * create), the same policy checks and the same RequestService, so offline and online writes
 * cannot diverge. Submit, cancel and the conversions stay online.
 */
final class PurchaseRequestSyncWriter implements SyncWriter
{
    public const string RESOURCE = 'purchase-requests';

    public function __construct(private readonly RequestService $service) {}

    public function resource(): string
    {
        return self::RESOURCE;
    }

    public function find(string $id): ?Model
    {
        return PurchaseRequest::query()->find($id);
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof PurchaseRequest ? $target->currentVersion() : 0;
    }

    public function isDraft(Model $target): bool
    {
        // A rejected request is editable like a draft (the web editor reopens it as a draft on save),
        // so REST and the offline path share RequestService's Draft|Rejected rule.
        return $target instanceof PurchaseRequest && in_array($target->status, [RequestStatus::Draft, RequestStatus::Rejected], true);
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        return TargetConstraints::satisfiedBy(
            $target,
            $constraints,
            static fn (Model $row, string $field): mixed => $field === 'status' && $row instanceof PurchaseRequest ? $row->currentStatus() : $row->getAttribute($field),
        );
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        return $this->run($user, null, function () use ($user, $mutation): WriteOutcome {
            $payload = [...array_diff_key($mutation->payload, ['id' => 1, 'version' => 1]), 'id' => $mutation->id];
            $form = $this->form($user, 'POST', '/api/v1/purchase-requests', $payload, 'create');
            $request = $this->service->create($form->headerData(), $form->lineData() ?? [], $user, $form->clientId());

            return $this->applied($request->id);
        });
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return $this->run($user, $target, function () use ($user, $mutation, $target, $version): WriteOutcome {
            // The client never sends `version` or `id`; the version the REST endpoint must see comes from the resolver.
            $payload = [...array_diff_key($mutation->payload, ['id' => 1, 'version' => 1]), 'version' => $version];
            $form = $this->form($user, 'PATCH', '/api/v1/purchase-requests/'.$target->getKey(), $payload, 'update');
            $this->authorizeTarget($user, 'update', $target);
            $request = $this->service->update($this->request($target), $form->headerData(), $form->lineData(), (int) $form->optionalVersion());

            return $this->applied($request->id);
        });
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return $this->run($user, $target, function () use ($user, $target, $version): WriteOutcome {
            Gate::forUser($user)->authorize('delete', PurchaseRequest::class);
            $this->authorizeTarget($user, 'delete', $target);
            $this->service->delete($this->request($target), $version);

            return WriteOutcome::deleted();
        });
    }

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        // submit / cancel / convert assign numbers and start approvals: online only.
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    public function lockedFields(): array
    {
        return ['status', 'number'];
    }

    public function auditFields(): array
    {
        // `lines` is not a column: PurchaseRequest::recordLineChange() adds it to the entry of a
        // save that replaced the lines, so a stale update of the lines is seen as a conflict.
        return ['number', 'status', 'document_date', 'needed_by', 'estimated_total', 'notes', 'version', 'lines'];
    }

    /**
     * Runs one write as $user and turns what REST would answer with an error into an outcome.
     *
     * @param  Closure(): WriteOutcome  $write
     */
    private function run(Authenticatable $user, ?Model $target, Closure $write): WriteOutcome
    {
        $previous = Auth::guard()->user();
        $switched = $previous?->getAuthIdentifier() !== $user->getAuthIdentifier();

        if ($switched) {
            Auth::setUser($user);
        }

        try {
            return $write();
        } catch (ValidationException $e) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $this->fields($e->errors()));
        } catch (AuthorizationException) {
            return WriteOutcome::rejected(ErrorCode::Forbidden);
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        } catch (ApiException $e) {
            if ($e->errorCode === ErrorCode::DocumentLocked && $target instanceof PurchaseRequest) {
                return $this->locked($target);
            }

            return WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
        } finally {
            if ($switched && $previous !== null) {
                Auth::setUser($previous);
            }
        }
    }

    /**
     * Another writer moved the request out of draft after the resolver looked at it.
     */
    private function locked(PurchaseRequest $target): WriteOutcome
    {
        $current = PurchaseRequest::query()->with('lines')->find($target->id) ?? $target;

        return WriteOutcome::conflict(SyncConflict::documentLocked(null, $current->currentVersion(), $this->data($current)));
    }

    private function applied(string $id): WriteOutcome
    {
        $request = PurchaseRequest::query()->with('lines')->findOrFail($id);

        return WriteOutcome::applied($request->currentVersion(), $this->data($request));
    }

    /**
     * @return array<string, mixed>
     */
    private function data(PurchaseRequest $request): array
    {
        return (new RequestResource($request))->resolve(new Request);
    }

    private function request(Model $target): PurchaseRequest
    {
        if (! $target instanceof PurchaseRequest) {
            throw new InvalidArgumentException('Target is not a purchase request.');
        }

        return $target;
    }

    private function authorizeTarget(Authenticatable $user, string $ability, Model $target): void
    {
        Gate::forUser($user)->authorize($ability, $this->request($target));
    }

    /**
     * The module's own form request, run on a synthetic request: route defaults name the policy
     * ability and the payload form exactly as routes.php does.
     *
     * @param  array<string, mixed>  $payload
     */
    private function form(Authenticatable $user, string $method, string $uri, array $payload, string $ability): DocumentRequest
    {
        $route = (new Route([$method], $uri, static fn (): null => null))
            ->defaults('ability', $ability)->defaults('model', PurchaseRequest::class)->defaults('form', 'request');
        $base = Request::create($uri, $method, $payload);
        $base->setRouteResolver(static fn (): Route => $route);
        $base->setUserResolver(static fn (): Authenticatable => $user);

        $form = DocumentRequest::createFrom($base);
        $form->setContainer(app())->setRedirector(app(Redirector::class));
        $form->validateResolved();

        return $form;
    }

    /**
     * @param  array<string, array<array-key, string>>  $errors
     * @return array<string, list<string>>
     */
    private function fields(array $errors): array
    {
        $out = [];

        foreach ($errors as $field => $messages) {
            $out[$field] = array_values($messages);
        }

        return $out;
    }
}
