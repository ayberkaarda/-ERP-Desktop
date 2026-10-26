<?php

declare(strict_types=1);

namespace App\Core\Sync;

use BackedEnum;
use Closure;
use Illuminate\Database\Eloquent\Model;

/**
 * One reading of manifest value constraints (target_constraints, payload_constraints) for every
 * SyncWriter::targetSatisfies(): field => allowed values, either the manifest's list of strings
 * or a single scalar. Values compare by their canonical string (enums by their value, booleans
 * as 'true'/'false'), the form the manifest writes them in; null and arrays never match.
 */
final class TargetConstraints
{
    /**
     * @param  array<string, mixed>  $constraints
     * @param  (Closure(Model, string): mixed)|null  $read  field reader; defaults to the model attribute
     */
    public static function satisfiedBy(Model $target, array $constraints, ?Closure $read = null): bool
    {
        foreach ($constraints as $field => $allowed) {
            $actual = self::canonical($read !== null ? $read($target, (string) $field) : $target->getAttribute((string) $field));
            $values = array_map(self::canonical(...), is_array($allowed) ? array_values($allowed) : [$allowed]);

            if ($actual === null || ! in_array($actual, $values, true)) {
                return false;
            }
        }

        return true;
    }

    public static function canonical(mixed $value): ?string
    {
        return match (true) {
            $value instanceof BackedEnum => (string) $value->value,
            is_bool($value) => $value ? 'true' : 'false',
            is_scalar($value) => (string) $value,
            default => null,
        };
    }
}
