<?php

declare(strict_types=1);

namespace App\Modules\Parties\Sync;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\ConflictChoice;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\TargetConstraints;
use App\Core\Sync\WriteOutcome;
use App\Modules\Parties\Http\Requests\PartyRequest;
use App\Modules\Parties\Http\Resources\PartyResource;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Services\DuplicateFinder;
use App\Modules\Parties\Services\PartyService;
use App\Modules\Parties\Validation\TaxNumber;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Write side of `parties`: create only (manifest). Replays the REST chain — PartyRequest (rules,
 * policy) then PartyService — and adds the duplicate check the REST create leaves to the web UI.
 *
 * Duplicates: after the permission check and validation, the same search as
 * GET /parties/duplicates. A hit answers `conflict` / DUPLICATE_RECORD with the candidate ids.
 * Validation runs first, so an active party with the same tax number is a VALIDATION_ERROR on
 * `tax_number`: a DUPLICATE_RECORD there would offer keep_mine, which the unique index blocks.
 * The search needs `viewAny` like the REST endpoint; without it there is nothing to show and the
 * contract requires at least one candidate, so the create proceeds as REST POST does.
 * Only a `resolution` {DUPLICATE_RECORD, keep_mine} (verified by the Sync module) skips the
 * search; a `payload.allow_duplicate` flag is dropped and never skips it.
 */
final class PartySyncWriter implements SyncWriter
{
    public function __construct(
        private readonly PartyService $parties,
        private readonly DuplicateFinder $duplicates,
    ) {}

    public function resource(): string
    {
        return PartySyncResource::NAME;
    }

    public function find(string $id): ?Model
    {
        return Party::query()->find($id);
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof Party ? $target->version : 0;
    }

    public function isDraft(Model $target): bool
    {
        return true;
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        return TargetConstraints::satisfiedBy($target, $constraints);
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        $payload = $mutation->payload;
        $keepMine = $mutation->resolution?->code === ErrorCode::DuplicateRecord
            && $mutation->resolution->choice === ConflictChoice::KeepMine;
        // Not a bypass: only a verified keep_mine resolution skips the duplicate search.
        unset($payload['allow_duplicate']);
        $payload['id'] = $mutation->id;

        try {
            $request = $this->request($user, $payload);

            if (! $request->authorize()) {
                return WriteOutcome::rejected(ErrorCode::Forbidden);
            }

            $request->validateResolved();
            /** @var array<string, mixed> $validated */
            $validated = $request->validated();

            if (! $keepMine && Gate::forUser($user)->allows('viewAny', Party::class)) {
                $candidates = $this->candidates($payload);

                if ($candidates !== []) {
                    return WriteOutcome::conflict(SyncConflict::duplicateRecord($candidates));
                }
            }

            $party = $this->parties->create($validated);
        } catch (ValidationException $e) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $this->fields($e->errors()));
        } catch (AuthorizationException) {
            return WriteOutcome::rejected(ErrorCode::Forbidden);
        } catch (ApiException $e) {
            return WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
        }

        $party->load(['addresses', 'contacts', 'bankAccounts']);
        /** @var array<string, mixed> $data */
        $data = json_decode(json_encode((new PartyResource($party))->resolve(new Request), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        return WriteOutcome::applied($party->version, $data);
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    public function lockedFields(): array
    {
        return ['code'];
    }

    public function auditFields(): array
    {
        return ['code', 'version', ...Party::FIELDS];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function request(Authenticatable $user, array $payload): PartyRequest
    {
        Auth::setUser($user);
        $base = Request::create('/api/v1/parties', 'POST', $payload);
        $request = PartyRequest::createFrom($base);
        $request->setContainer(app())->setRedirector(app('redirect'));
        $request->setUserResolver(static fn (): Authenticatable => $user);

        return $request;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<string>
     */
    private function candidates(array $payload): array
    {
        $name = is_string($payload['name'] ?? null) ? $payload['name'] : null;
        $country = is_string($payload['country'] ?? null) ? strtoupper(trim($payload['country'])) : 'TR';
        $tax = is_string($payload['tax_number'] ?? null) ? TaxNumber::normalize($payload['tax_number'], $country) : null;

        return array_map(
            static fn (array $match): string => $match['party']->id,
            $this->duplicates->find($tax === '' ? null : $tax, $name),
        );
    }

    /**
     * @param  array<string, array<array-key, string>>  $errors
     * @return array<string, list<string>>
     */
    private function fields(array $errors): array
    {
        return array_map(static fn (array $messages): array => array_values($messages), $errors);
    }
}
