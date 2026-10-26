<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Http\ExceptionRenderer;
use App\Core\Idempotency\ClaimStatus;
use App\Core\Sync\ConflictChoice;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\MutationOp;
use App\Core\Sync\OutcomeStatus;
use App\Core\Sync\Rules\ClientKey;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\WriteOutcome;
use App\Models\User;
use App\Modules\Sync\Manifest\WriteDefinition;
use App\Modules\Sync\Manifest\WriteOp;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Gate;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

/**
 * POST /sync/push (SYNC-PROTOCOL "İşleme"). Mutations run in order, each in its own
 * transaction; the batch is not atomic.
 *
 * Per mutation: manifest + current permission (3), class/row policy on the locked target (4),
 * idempotency claim or replay (5), dependencies (6), resolution, changed_fields, payload
 * constraints (7), target constraints, draft_only and version rules (8), then the module's
 * own REST chain through its writer (9) inside a savepoint. Authorization refusals and reused
 * keys are never stored; every other result is, with the full body, for the push retention.
 */
final class PushService
{
    /** Columns and resource keys every write may change on its own. */
    private const array BOOKKEEPING = ['version', 'updated_at', 'sync_txid'];

    /**
     * Keys of this batch in order, with the outcome of those already processed.
     *
     * @var array<string, array{index: int, id: string, status: OutcomeStatus|null, dependency_failed: bool}>
     */
    private array $batch = [];

    /** @var array<string, bool> */
    private static array $companyColumn = [];

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly ManifestService $manifests,
        private readonly Adapters $adapters,
        private readonly ConflictResolver $resolver,
        private readonly PushResults $results,
        private readonly Rows $rows,
        private readonly Gate $gate,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $mutations  shape checked by PushRequest (key, resource, id)
     * @return list<array<string, mixed>>
     */
    public function push(User $user, string $companyId, array $mutations): array
    {
        $this->batch = [];

        foreach ($mutations as $i => $raw) {
            $key = self::str($raw['idempotency_key'] ?? null);
            $this->batch[$key] ??= ['index' => $i, 'id' => self::str($raw['id'] ?? null), 'status' => null, 'dependency_failed' => false];
        }

        $out = [];

        foreach ($mutations as $i => $raw) {
            $result = $this->one($user, $companyId, $raw, $i);
            $out[] = $result;

            $key = self::str($raw['idempotency_key'] ?? null);

            if (($this->batch[$key]['index'] ?? null) === $i) {
                $this->batch[$key]['status'] = OutcomeStatus::from(self::str($result['status']));
                $this->batch[$key]['dependency_failed'] = ($result['error']['code'] ?? null) === ErrorCode::SyncDependencyFailed->value;
            }
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    private function one(User $user, string $companyId, array $raw, int $index): array
    {
        $echo = [
            'idempotency_key' => self::str($raw['idempotency_key'] ?? null),
            'resource' => self::str($raw['resource'] ?? null),
            'id' => self::str($raw['id'] ?? null),
        ];

        try {
            $mutation = Mutation::fromArray($raw);
        } catch (ApiException $e) {
            return [...$echo, ...WriteOutcome::rejected(ErrorCode::ValidationError, fields: $e->fields)->toArray(), 'replayed' => false];
        }

        $shape = $this->shapeErrors($mutation);

        if ($shape !== null) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $shape)->toResult($mutation);
        }

        $resource = $this->manifests->manifest()->find($mutation->resource);
        $adapter = $resource !== null && $resource->isPull() ? $this->adapters->resource($resource->name) : null;
        $writer = $adapter !== null ? $this->adapters->writer($mutation->resource) : null;

        if ($resource === null || $adapter === null || ($resource->write !== null && $writer === null)) {
            return WriteOutcome::rejected(ErrorCode::SyncResourceUnsupported)->toResult($mutation);
        }

        $op = $resource->write?->op($mutation->op, $mutation->action);

        if ($resource->write === null || $op === null) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed)->toResult($mutation);
        }

        if (! $op->requires->satisfiedBy($this->manifests->granted($user, $companyId))) {
            return WriteOutcome::rejected(ErrorCode::Forbidden)->toResult($mutation);
        }

        try {
            /** @var array<string, mixed> */
            return $this->db->transaction(fn (): array => $this->locked($user, $companyId, $mutation, $index, $resource->write, $op, $adapter, $writer));
        } catch (Interrupt $interrupt) {
            return $interrupt->outcome->toResult($mutation);
        } catch (QueryException $e) {
            // A row lock another transaction holds (55P03: NOWAIT refused or lock_timeout, on the
            // target lock or inside the writer) is no answer to the mutation: transient, like
            // IDEMPOTENCY_IN_PROGRESS (SYNC-PROTOCOL). Only this mutation's transaction (claim
            // included) rolls back; mutations before it stay committed with their stored results,
            // and the client's retry with the same keys replays them and runs this one again.
            if (ExceptionRenderer::lockNotAvailable($e)) {
                throw new ApiException(ErrorCode::IdempotencyInProgress, headers: ['Retry-After' => '1']);
            }

            throw $e;
        }
    }

    /**
     * Steps 4-9 inside the mutation's transaction.
     *
     * @return array<string, mixed>
     */
    private function locked(User $user, string $companyId, Mutation $mutation, int $index, WriteDefinition $write, WriteOp $op, SyncResource $adapter, SyncWriter $writer): array
    {
        $gate = $this->gate->forUser($user);
        $table = $adapter->table();
        $modelClass = $adapter->query($companyId)->getModel()::class;
        $create = $mutation->op === MutationOp::Create;

        if (! $gate->allows($create ? 'create' : 'viewAny', $modelClass)) {
            throw Interrupt::unstored(WriteOutcome::rejected(ErrorCode::Forbidden));
        }

        // The lock only ever reaches rows of the active company: another company's row is
        // filtered out before it is locked, so its lock holder cannot make this request wait.
        $lock = $this->db->table($table)->where('id', $mutation->id);

        if ($this->hasCompany($table)) {
            $lock->where('company_id', $companyId);
        }

        $raw = $lock->lockForUpdate()->first();
        $target = $raw !== null ? $writer->find($mutation->id) : null;
        $scope = $this->results->scope($user->id, $companyId, $mutation->idempotencyKey);

        if ($create) {
            // The id belongs to another company: an existence probe without lock and without
            // data, answered like any taken id.
            if ($raw === null && $this->db->table($table)->where('id', $mutation->id)->exists()) {
                throw Interrupt::unstored(self::idTaken());
            }

            if ($raw !== null && $target === null) {
                // Another company's row (or a removed one): same answer as a taken id, nothing leaks.
                throw Interrupt::unstored(self::idTaken());
            }

            if ($target !== null && ! $gate->allows('view', $target)) {
                throw Interrupt::unstored(WriteOutcome::rejected(ErrorCode::Forbidden));
            }
        } elseif ($target === null) {
            $stored = $mutation->op === MutationOp::Delete ? $this->results->find($scope) : null;

            if ($stored === null || $stored->outcome->status !== OutcomeStatus::Applied) {
                throw Interrupt::unstored(WriteOutcome::rejected(ErrorCode::NotFound));
            }
        } elseif (! $gate->allows('view', $target) || ! $gate->allows($mutation->op === MutationOp::Delete ? 'delete' : 'update', $target)) {
            throw Interrupt::unstored(WriteOutcome::rejected(ErrorCode::Forbidden));
        }

        $claim = $this->results->claim($scope, $mutation, $this->manifests->config()->idempotencyTtlSeconds());

        if ($claim->status === ClaimStatus::Reused) {
            throw Interrupt::unstored(WriteOutcome::rejected(ErrorCode::IdempotencyKeyReused));
        }

        if ($claim->status === ClaimStatus::InProgress) {
            throw new ApiException(ErrorCode::IdempotencyInProgress);
        }

        if ($claim->status === ClaimStatus::Completed && $claim->response !== null) {
            return $this->replay(StoredResult::fromResponse($claim->response), $mutation, $adapter, $writer, $companyId, $target);
        }

        // A taken id answers VALIDATION_ERROR, unless the mutation is a resolution that no longer
        // resolves anything (its conflict was superseded): that is SYNC_RESOLUTION_INVALID.
        $outcome = $create && $target !== null
            ? ($this->resolution($user, $companyId, $mutation) ?? self::idTaken())
            : $this->process($user, $companyId, $mutation, $index, $write, $op, $adapter, $writer, $target, $raw);

        $this->results->complete((string) $claim->claimId, $mutation, $outcome);

        if ($outcome->status === OutcomeStatus::Applied && $mutation->resolution !== null && $this->resolutionApplies($user, $companyId, $mutation)) {
            $this->results->supersede($this->results->scope($user->id, $companyId, $mutation->resolution->resolves), $mutation->idempotencyKey);
        }

        return $outcome->toResult($mutation);
    }

    /**
     * Steps 6-9 for a freshly claimed key.
     */
    private function process(User $user, string $companyId, Mutation $mutation, int $index, WriteDefinition $write, WriteOp $op, SyncResource $adapter, SyncWriter $writer, ?Model $target, ?object $raw): WriteOutcome
    {
        $failed = $this->dependencies($user, $companyId, $mutation, $index)
            ?? $this->resolution($user, $companyId, $mutation)
            ?? $this->fieldSet($mutation, $write, $writer);

        if ($failed !== null) {
            return $failed;
        }

        if ($target === null) {
            // A keep_mine for another body than the one that got DUPLICATE_RECORD does not
            // apply: the writer sees no resolution and runs its duplicate search again.
            $create = $this->resolutionApplies($user, $companyId, $mutation) ? $mutation : self::withoutResolution($mutation);

            return $this->write($user, $companyId, $create, $adapter, $writer, null, Decision::apply(0), []);
        }

        $before = $raw === null ? [] : (array) $raw;

        foreach ($write->targetConstraints as $field => $allowed) {
            if (! array_key_exists($field, $before) || ! in_array(self::scalar($before[$field]), $allowed, true)) {
                return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
            }
        }

        $current = $writer->currentVersion($target);
        $serverData = fn (): array => $this->rows->current($adapter, $companyId, $mutation->id) ?? [];

        if ($write->draftOnly !== null && ! $writer->isDraft($target)) {
            return WriteOutcome::conflict(SyncConflict::documentLocked($mutation->baseVersion, $current, $serverData()));
        }

        $decision = $this->resolver->decide($write, $op, $mutation, $target, $current, $writer, $serverData);

        if ($decision->rejection !== null) {
            return WriteOutcome::rejected($decision->rejection);
        }

        if ($decision->conflict !== null) {
            return WriteOutcome::conflict($decision->conflict);
        }

        return $this->write($user, $companyId, $mutation, $adapter, $writer, $target, $decision, $before);
    }

    /**
     * Step 9: the writer replays the module's REST chain inside a savepoint. Anything but an
     * applied outcome rolls the savepoint back; a merge over newer server changes is also
     * rolled back when a column outside the effective write set changed (an undeclared
     * derivation, SYNC-PROTOCOL "Beyan edilmemiş türetme çakışmadır").
     *
     * @param  array<string, mixed>  $before  locked pre-image of the target row
     */
    private function write(User $user, string $companyId, Mutation $mutation, SyncResource $adapter, SyncWriter $writer, ?Model $target, Decision $decision, array $before): WriteOutcome
    {
        $version = (int) $decision->version;
        $merge = $decision->effectiveFields;
        $beforeJson = $merge !== null ? $this->rows->current($adapter, $companyId, $mutation->id) : null;

        try {
            /** @var WriteOutcome $outcome */
            $outcome = $this->db->transaction(function () use ($user, $companyId, $mutation, $adapter, $writer, $target, $version, $merge, $before, $beforeJson): WriteOutcome {
                $outcome = match ($mutation->op) {
                    MutationOp::Create => $writer->create($user, $mutation),
                    MutationOp::Update => $writer->update($user, $mutation, self::need($target), $version),
                    MutationOp::Delete => $writer->delete($user, $mutation, self::need($target), $version),
                    MutationOp::Action => $writer->action($user, $mutation, self::need($target), $version),
                };

                if ($outcome->status !== OutcomeStatus::Applied) {
                    throw Interrupt::rollback($outcome);
                }

                if ($merge !== null) {
                    $undeclared = $this->undeclared($adapter, $companyId, $mutation->id, $before, $beforeJson ?? [], $merge);

                    if ($undeclared !== []) {
                        throw Interrupt::rollback(WriteOutcome::conflict($this->resolver->versionConflict(
                            $mutation,
                            $version,
                            $undeclared,
                            $beforeJson ?? [],
                        )));
                    }
                }

                return $outcome;
            });
        } catch (Interrupt $interrupt) {
            $outcome = $interrupt->outcome;
        } catch (AuthorizationException) {
            $outcome = WriteOutcome::rejected(ErrorCode::Forbidden);
        } catch (ValidationException $e) {
            /** @var array<string, list<string>> $fields */
            $fields = $e->errors();
            $outcome = WriteOutcome::rejected(ErrorCode::ValidationError, fields: $fields);
        } catch (ModelNotFoundException) {
            $outcome = WriteOutcome::rejected(ErrorCode::NotFound);
        } catch (ApiException $e) {
            // Transient failures are not an answer to the mutation: the mutation transaction
            // rolls back (claim included), nothing is stored and the error keeps its headers.
            if (self::transient($e->errorCode)) {
                throw $e;
            }

            $outcome = WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
        } catch (QueryException $e) {
            // A busy row lock (55P03) is rethrown below and answered in one() as transient.
            // A concurrent create took the client id between the lock and the insert: the
            // savepoint is gone, the answer is the same as for a taken id.
            if ($mutation->op !== MutationOp::Create || ! self::primaryKeyViolation($e, $adapter->table())) {
                throw $e;
            }

            $outcome = self::idTaken();
        }

        return $this->settle($companyId, $mutation, $adapter, $writer, $outcome, $decision);
    }

    /**
     * REST refusals that are conflicts on the wire, and refusals that must not be stored.
     */
    private function settle(string $companyId, Mutation $mutation, SyncResource $adapter, SyncWriter $writer, WriteOutcome $outcome, Decision $decision): WriteOutcome
    {
        if ($outcome->status === OutcomeStatus::Applied) {
            return $decision->effectiveFields !== null && $outcome->data !== null
                ? WriteOutcome::applied((int) $outcome->version, $outcome->data, $decision->mergedFields)
                : $outcome;
        }

        if ($outcome->status !== OutcomeStatus::Rejected) {
            return $outcome;
        }

        if ($outcome->errorCode === ErrorCode::Forbidden) {
            throw Interrupt::unstored($outcome);
        }

        if ($outcome->errorCode !== null && self::transient($outcome->errorCode)) {
            throw new ApiException($outcome->errorCode, $outcome->errorMessage);
        }

        $fresh = $mutation->op === MutationOp::Create ? null : $writer->find($mutation->id);
        $data = $fresh !== null ? $this->rows->current($adapter, $companyId, $mutation->id) : null;

        if ($fresh !== null && $data !== null && $outcome->errorCode === ErrorCode::VersionConflict) {
            return WriteOutcome::conflict($this->resolver->versionConflict($mutation, $writer->currentVersion($fresh), [], $data));
        }

        if ($fresh !== null && $data !== null && $outcome->errorCode === ErrorCode::DocumentLocked) {
            return WriteOutcome::conflict(SyncConflict::documentLocked($mutation->baseVersion, $writer->currentVersion($fresh), $data));
        }

        return $outcome;
    }

    /**
     * Columns of the target row and keys of its REST JSON that the write changed outside the
     * effective write set.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $beforeJson
     * @param  list<string>  $effective
     * @return list<string>
     */
    private function undeclared(SyncResource $adapter, string $companyId, string $id, array $before, array $beforeJson, array $effective): array
    {
        $after = (array) ($this->db->table($adapter->table())->where('id', $id)->first() ?? []);
        $afterJson = $this->rows->current($adapter, $companyId, $id) ?? [];
        $allowed = array_fill_keys([...$effective, ...self::BOOKKEEPING], true);
        $changed = [];

        foreach ([[$before, $after], [$beforeJson, $afterJson]] as [$old, $new]) {
            foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $field) {
                $field = (string) $field;

                if (! isset($allowed[$field]) && self::canonical($old[$field] ?? null) !== self::canonical($new[$field] ?? null)) {
                    $changed[$field] = true;
                }
            }
        }

        $names = array_map('strval', array_keys($changed));
        sort($names);

        return $names;
    }

    /**
     * Step 5 for a key that has a stored result: same status and body, applied as duplicate.
     * A conflict's server_version and server_data are rebuilt from the row locked in step 4.
     *
     * @return array<string, mixed>
     */
    private function replay(StoredResult $stored, Mutation $mutation, SyncResource $adapter, SyncWriter $writer, string $companyId, ?Model $target): array
    {
        $outcome = $stored->outcome->replay();
        $conflict = $outcome->conflict;

        if ($outcome->status === OutcomeStatus::Conflict && $conflict !== null && $target !== null
            && in_array($conflict->code, [ErrorCode::VersionConflict, ErrorCode::DocumentLocked], true)) {
            $data = $this->rows->current($adapter, $companyId, $mutation->id);

            if ($data !== null) {
                $outcome = WriteOutcome::conflict(new SyncConflict(
                    $conflict->code,
                    $conflict->baseVersion,
                    $writer->currentVersion($target),
                    $conflict->conflictingFields,
                    $data,
                    $conflict->choices,
                    $conflict->candidates,
                    $conflict->message,
                ));
            }
        }

        return $outcome->toResult($mutation, replayed: true);
    }

    /**
     * Step 6: earlier mutations of the same id in this batch, and depends_on keys, must have
     * succeeded. depends_on may only point back: to an earlier key of this batch or to a key
     * with a stored result. The conflict a resolution resolves does not block it, and neither
     * do mutations that only failed because of an earlier one.
     */
    private function dependencies(User $user, string $companyId, Mutation $mutation, int $index): ?WriteOutcome
    {
        $resolves = $mutation->resolution?->resolves;

        foreach ($this->batch as $key => $entry) {
            if ($entry['index'] >= $index || $entry['id'] !== $mutation->id || $key === $resolves
                || $key === $mutation->idempotencyKey || $entry['dependency_failed']) {
                continue;
            }

            if (! self::succeeded($entry['status'])) {
                return WriteOutcome::rejected(ErrorCode::SyncDependencyFailed);
            }
        }

        foreach ($mutation->dependsOn as $key) {
            if ($key === $resolves) {
                continue;
            }

            $entry = $this->batch[$key] ?? null;

            if ($key === $mutation->idempotencyKey || ($entry !== null && $entry['index'] >= $index)) {
                return WriteOutcome::rejected(ErrorCode::ValidationError, fields: ['depends_on' => [__('sync::sync.depends_on_forward')]]);
            }

            if ($entry !== null) {
                if (! self::succeeded($entry['status'])) {
                    return WriteOutcome::rejected(ErrorCode::SyncDependencyFailed);
                }

                continue;
            }

            $stored = $this->results->find($this->results->scope($user->id, $companyId, $key));

            if ($stored === null) {
                return WriteOutcome::rejected(ErrorCode::ValidationError, fields: ['depends_on' => [__('sync::sync.depends_on_unknown')]]);
            }

            if ($stored->outcome->status !== OutcomeStatus::Applied) {
                return WriteOutcome::rejected(ErrorCode::SyncDependencyFailed);
            }
        }

        return null;
    }

    /**
     * A resolution must point at a stored, not yet superseded conflict of the same user,
     * company, resource and id, with a choice that conflict allows for this op.
     */
    private function resolution(User $user, string $companyId, Mutation $mutation): ?WriteOutcome
    {
        $resolution = $mutation->resolution;

        if ($resolution === null) {
            return null;
        }

        $scope = $this->results->scope($user->id, $companyId, $resolution->resolves);
        $stored = $resolution->resolves === $mutation->idempotencyKey ? null : $this->results->find($scope);
        $conflict = $stored?->outcome->conflict;

        $valid = $stored !== null
            && $conflict !== null
            && $stored->outcome->status === OutcomeStatus::Conflict
            && $stored->resource === $mutation->resource
            && $stored->id === $mutation->id
            && $conflict->code === $resolution->code
            && ! $this->results->isSuperseded($scope)
            && match ($resolution->code) {
                ErrorCode::VersionConflict => ($resolution->choice === ConflictChoice::KeepMine
                        && $stored->op === $mutation->op->value && $stored->action === $mutation->action)
                    || ($resolution->choice === ConflictChoice::Merge
                        && $stored->op === MutationOp::Update->value && $mutation->op === MutationOp::Update),
                ErrorCode::DuplicateRecord => $resolution->choice === ConflictChoice::KeepMine
                    && $stored->op === MutationOp::Create->value && $mutation->op === MutationOp::Create,
                default => false,
            };

        return $valid ? null : WriteOutcome::rejected(ErrorCode::SyncResolutionInvalid);
    }

    /**
     * changed_fields equal to the payload keys (update, action), fields offline writes may
     * never set, and payload_constraints (create, update).
     */
    private function fieldSet(Mutation $mutation, WriteDefinition $write, SyncWriter $writer): ?WriteOutcome
    {
        $keys = array_map('strval', array_keys($mutation->payload));

        if ($mutation->op === MutationOp::Update || $mutation->op === MutationOp::Action) {
            $changed = $mutation->changedFields;
            $sortedKeys = $keys;
            sort($changed);
            sort($sortedKeys);

            if ($changed !== $sortedKeys) {
                return WriteOutcome::rejected(ErrorCode::SyncChangedFieldsMismatch);
            }
        }

        if (array_intersect($keys, $writer->lockedFields()) !== []) {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        if ($mutation->op === MutationOp::Create || $mutation->op === MutationOp::Update) {
            foreach ($write->payloadConstraints as $field => $allowed) {
                if (array_key_exists($field, $mutation->payload) && ! in_array(self::scalar($mutation->payload[$field]), $allowed, true)) {
                    return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
                }
            }
        }

        return null;
    }

    /**
     * Op-dependent shape rules the push schema states with if/then.
     *
     * @return array<string, list<string>>|null
     */
    private function shapeErrors(Mutation $mutation): ?array
    {
        $errors = [];
        $op = $mutation->op;

        if ($op === MutationOp::Create && $mutation->baseVersion !== null) {
            $errors['base_version'] = [__('sync::sync.base_version_create')];
        }

        if ($op !== MutationOp::Create && $mutation->baseVersion === null) {
            $errors['base_version'] = [__('sync::sync.base_version_required')];
        }

        if (($op === MutationOp::Create || $op === MutationOp::Delete) && $mutation->changedFields !== []) {
            $errors['changed_fields'] = [__('sync::sync.changed_fields_empty')];
        }

        if ($op === MutationOp::Delete && $mutation->payload !== []) {
            $errors['payload'] = [__('sync::sync.payload_empty')];
        }

        if (($op === MutationOp::Update || $op === MutationOp::Action) && ($mutation->changedFields === [] || $mutation->payload === [])) {
            $errors['changed_fields'] = [__('sync::sync.changed_fields_required')];
        }

        if (($op === MutationOp::Action) !== ($mutation->action !== null)) {
            $errors['action'] = [__('sync::sync.action_mismatch')];
        }

        if (array_key_exists('version', $mutation->payload)) {
            $errors['payload'] = [__('sync::sync.payload_version')];
        }

        return $errors === [] ? null : $errors;
    }

    /**
     * A valid resolution applies to this mutation. DUPLICATE_RECORD keep_mine only covers the
     * payload that got the conflict (same canonical digest); VERSION_CONFLICT choices always
     * apply, since they are checked against the current version anyway.
     */
    private function resolutionApplies(User $user, string $companyId, Mutation $mutation): bool
    {
        $resolution = $mutation->resolution;

        if ($resolution === null) {
            return false;
        }

        if ($resolution->code !== ErrorCode::DuplicateRecord) {
            return true;
        }

        $stored = $this->results->find($this->results->scope($user->id, $companyId, $resolution->resolves));

        return $stored?->payloadHash !== null && hash_equals($stored->payloadHash, PushResults::payloadHash($mutation->payload));
    }

    private static function withoutResolution(Mutation $mutation): Mutation
    {
        return new Mutation(
            $mutation->idempotencyKey,
            $mutation->op,
            $mutation->resource,
            $mutation->id,
            $mutation->baseVersion,
            $mutation->changedFields,
            $mutation->occurredAt,
            $mutation->payload,
            $mutation->action,
            $mutation->parentId,
            $mutation->dependsOn,
        );
    }

    private static function transient(ErrorCode $code): bool
    {
        return in_array($code, [ErrorCode::ServerError, ErrorCode::TooManyAttempts, ErrorCode::IdempotencyInProgress], true);
    }

    private function hasCompany(string $table): bool
    {
        return self::$companyColumn[$table] ??= Schema::hasColumn($table, 'company_id');
    }

    private static function idTaken(): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::ValidationError, fields: ['id' => [ClientKey::message()]]);
    }

    private static function primaryKeyViolation(QueryException $e, string $table): bool
    {
        $sqlState = is_string($e->errorInfo[0] ?? null) ? $e->errorInfo[0] : (string) $e->getCode();

        return $sqlState === '23505' && str_contains($e->getMessage(), "\"{$table}_pkey\"");
    }

    private static function succeeded(?OutcomeStatus $status): bool
    {
        return $status === OutcomeStatus::Applied || $status === OutcomeStatus::Duplicate;
    }

    private static function need(?Model $target): Model
    {
        return $target ?? throw new ModelNotFoundException;
    }

    private static function scalar(mixed $value): ?string
    {
        return match (true) {
            is_bool($value) => $value ? 'true' : 'false',
            is_scalar($value) => (string) $value,
            $value instanceof \BackedEnum => (string) $value->value,
            default => null,
        };
    }

    private static function canonical(mixed $value): string
    {
        return json_encode($value, JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE) ?: '';
    }

    private static function str(mixed $value): string
    {
        return is_string($value) ? $value : '';
    }
}
