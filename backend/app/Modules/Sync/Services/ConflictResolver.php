<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Http\ErrorCode;
use App\Core\Sync\ConflictChoice;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\MutationOp;
use App\Core\Sync\SyncConflict;
use App\Modules\Sync\Manifest\WriteDefinition;
use App\Modules\Sync\Manifest\WriteOp;
use Illuminate\Database\Eloquent\Model;

/**
 * Version rules of SYNC-PROTOCOL "Sürüm kontrolü" and conflict rules 2-4, decided on the target
 * row locked by the push service. Draft and target constraints are checked before this.
 *
 * - base_version above the server version: rejected SYNC_BASE_VERSION_AHEAD (every op).
 * - exact (delete, action, exact update): any difference is VERSION_CONFLICT, no field overlap.
 * - field-merge: current base applies as is; an older base is merged when the effective write
 *   set (changed fields + declared derivations) does not meet what the server changed since,
 *   per the activity log. Unknown history or fields the log does not track count as changed.
 */
final readonly class ConflictResolver
{
    public function __construct(private AuditDiff $audit) {}

    /**
     * @param  callable(): array<string, mixed>  $serverData  current REST JSON of the target
     */
    public function decide(WriteDefinition $write, WriteOp $op, Mutation $mutation, Model $target, int $current, SyncWriter $writer, callable $serverData): Decision
    {
        $base = (int) $mutation->baseVersion;

        if ($base > $current) {
            return Decision::reject(ErrorCode::SyncBaseVersionAhead);
        }

        if ($base === $current) {
            return Decision::apply($base);
        }

        if (! $op->isFieldMerge() || $mutation->op !== MutationOp::Update) {
            return Decision::conflict($this->versionConflict($mutation, $current, [], $serverData()));
        }

        $effective = $write->effectiveFields($mutation->changedFields, array_map('strval', array_keys($mutation->payload)));
        $overlap = $this->conflictingFields($write, $mutation, $target, $current, $writer);

        if ($overlap !== []) {
            return Decision::conflict($this->versionConflict($mutation, $current, $overlap, $serverData()));
        }

        $merged = $mutation->changedFields;
        sort($merged);

        return Decision::merge($current, $merged, $effective);
    }

    /** @return list<string> */
    public function conflictingFields(WriteDefinition $write, Mutation $mutation, Model $target, int $current, SyncWriter $writer): array
    {
        $effective = $write->effectiveFields($mutation->changedFields, array_map('strval', array_keys($mutation->payload)));
        $changed = $this->audit->changedSince($target, (int) $mutation->baseVersion, $current);
        $fields = $changed === null ? $effective
            : array_values(array_intersect($effective, [...$changed, ...array_diff($effective, $writer->auditFields())]));
        sort($fields);

        return array_values(array_unique($fields));
    }

    /**
     * VERSION_CONFLICT body. Delete and action conflicts offer keep_mine and take_server only.
     *
     * @param  list<string>  $fields
     * @param  array<string, mixed>  $serverData
     */
    public function versionConflict(Mutation $mutation, int $current, array $fields, array $serverData): SyncConflict
    {
        $choices = $mutation->op === MutationOp::Update
            ? [ConflictChoice::KeepMine, ConflictChoice::TakeServer, ConflictChoice::Merge]
            : [ConflictChoice::KeepMine, ConflictChoice::TakeServer];

        return new SyncConflict(ErrorCode::VersionConflict, (int) $mutation->baseVersion, $current, $fields, $serverData, $choices);
    }
}
