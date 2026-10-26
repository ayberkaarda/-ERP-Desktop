<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * Fields the server changed on a record after a version, read from the activity log
 * (activity_log.attribute_changes.attributes, the logOnly fields of the model).
 *
 * The answer is only trusted when every version step base+1..current has a log entry that
 * records its version; otherwise it is unknown (null) and the caller treats every field as
 * changed (SYNC-PROTOCOL conflict rule 4).
 */
final readonly class AuditDiff
{
    private const array IGNORED = ['version', 'updated_at', 'created_at'];

    public function __construct(private ConnectionInterface $db) {}

    /**
     * @return list<string>|null field names changed in versions (base, current], or null when unknown
     */
    public function changedSince(Model $target, int $baseVersion, int $currentVersion): ?array
    {
        if ($currentVersion <= $baseVersion) {
            return [];
        }

        $entries = $this->db->table('activity_log')
            ->where('subject_type', $target->getMorphClass())
            ->where('subject_id', (string) $target->getKey())
            ->whereRaw("(attribute_changes -> 'attributes' ->> 'version') ~ '^[0-9]+$'")
            ->whereRaw("(attribute_changes -> 'attributes' ->> 'version')::bigint > ?", [$baseVersion])
            ->whereRaw("(attribute_changes -> 'attributes' ->> 'version')::bigint <= ?", [$currentVersion])
            ->pluck('attribute_changes');

        $seen = [];
        $fields = [];

        foreach ($entries as $raw) {
            $changes = is_string($raw) ? json_decode($raw, true) : null;
            $attributes = is_array($changes) && is_array($changes['attributes'] ?? null) ? $changes['attributes'] : [];
            $version = $attributes['version'] ?? null;

            if (! is_numeric($version)) {
                continue;
            }

            $seen[(int) $version] = true;

            foreach (array_keys($attributes) as $field) {
                if (is_string($field) && ! in_array($field, self::IGNORED, true)) {
                    $fields[$field] = true;
                }
            }
        }

        for ($v = $baseVersion + 1; $v <= $currentVersion; $v++) {
            if (! isset($seen[$v])) {
                return null;
            }
        }

        $names = array_map('strval', array_keys($fields));
        sort($names);

        return $names;
    }
}
