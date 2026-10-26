<?php

declare(strict_types=1);

namespace App\Core\Sync\Contracts;

use App\Core\Sync\Mutation;
use App\Core\Sync\WriteOutcome;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

/**
 * Write side of one offline-manifest resource, tagged with self::TAG by the owning module.
 *
 * The Sync module owns the request-level checks, the idempotency claim, the transaction and
 * the conflict decision (version, draft_only, changed fields). The writer replays the module's
 * own REST chain for the mutation — FormRequest rules, Policy, Service — against the target it
 * is handed, and reports the result; validation and authorization failures come back as a
 * rejected outcome rather than an exception. Payloads never contain `version`; the Sync
 * module passes the version the REST endpoint must see.
 */
interface SyncWriter
{
    public const string TAG = 'sync.writers';

    /** Manifest resource name this writer accepts. */
    public function resource(): string;

    /**
     * Target row inside the active company (company scope applied), or null.
     */
    public function find(string $id): ?Model;

    public function currentVersion(Model $target): int;

    /** False once the record left draft; edits then conflict with DOCUMENT_LOCKED. */
    public function isDraft(Model $target): bool;

    /**
     * Whether the stored record satisfies the manifest's payload_constraints
     * (e.g. ['doc_type' => 'count']), so offline writes cannot widen what may be edited.
     *
     * @param  array<string, mixed>  $constraints
     */
    public function targetSatisfies(Model $target, array $constraints): bool;

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome;

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome;

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome;

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome;

    /**
     * Fields a client can never change offline (e.g. status); a mutation that changes one is
     * rejected with SYNC_OFFLINE_WRITE_NOT_ALLOWED.
     *
     * @return list<string>
     */
    public function lockedFields(): array;

    /**
     * Fields recorded by the activity log, used to tell which fields changed since base_version.
     *
     * @return list<string>
     */
    public function auditFields(): array;
}
