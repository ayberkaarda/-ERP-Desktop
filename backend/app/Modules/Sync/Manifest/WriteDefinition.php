<?php

declare(strict_types=1);

namespace App\Modules\Sync\Manifest;

use App\Core\Sync\MutationOp;

/**
 * A resource's `write` block of offline-manifest.json.
 */
final readonly class WriteDefinition
{
    /**
     * @param  list<WriteOp>  $ops
     * @param  list<array{when: list<string>, derives: list<string>}>  $derivedFields
     * @param  array<string, list<string>>  $targetConstraints
     * @param  array<string, list<string>>  $payloadConstraints
     * @param  array{field: string, value: string}|null  $draftOnly
     */
    public function __construct(
        public array $ops,
        public array $derivedFields = [],
        public ?array $draftOnly = null,
        public array $targetConstraints = [],
        public array $payloadConstraints = [],
        public ?string $duplicateCheck = null,
    ) {}

    public function op(MutationOp $op, ?string $action): ?WriteOp
    {
        foreach ($this->ops as $candidate) {
            if ($candidate->op === $op && ($op !== MutationOp::Action || $candidate->action === $action)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Effective write set (SYNC-PROTOCOL "Etkin yazma kümesi"): the changed fields plus every
     * derived field whose trigger is in the set and which the payload does not give itself,
     * chained to a fixed point; `*` rules apply to every update.
     *
     * @param  list<string>  $changedFields
     * @param  list<string>  $payloadKeys
     * @return list<string>
     */
    public function effectiveFields(array $changedFields, array $payloadKeys): array
    {
        $set = array_fill_keys($changedFields, true);
        $given = array_fill_keys($payloadKeys, true);

        do {
            $grew = false;

            foreach ($this->derivedFields as $rule) {
                $fires = in_array('*', $rule['when'], true) || array_intersect_key(array_fill_keys($rule['when'], true), $set) !== [];

                if (! $fires) {
                    continue;
                }

                foreach ($rule['derives'] as $field) {
                    if (! isset($set[$field]) && ! isset($given[$field])) {
                        $set[$field] = true;
                        $grew = true;
                    }
                }
            }
        } while ($grew);

        $fields = array_map('strval', array_keys($set));
        sort($fields);

        return $fields;
    }
}
