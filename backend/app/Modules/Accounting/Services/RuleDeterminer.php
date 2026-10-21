<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Data\AccountRef;
use App\Modules\Accounting\Exceptions\AccountNotDetermined;
use App\Modules\Accounting\Models\AccountDeterminationRule;

/**
 * Picks, among the active rules of the event (exact key or a "prefix.*" wildcard), the one with
 * the highest priority whose conditions all match the context; ties go to the more specific rule
 * (exact key, then more conditions), then to the older rule. A rule without conditions is the
 * event's fallback. Rules pointing at inactive or non-postable accounts are skipped.
 */
final class RuleDeterminer implements AccountDeterminer
{
    /** Context keys conditions may use. */
    public const array CONDITION_KEYS = ['party_group', 'party_id', 'item_category', 'item_id', 'currency', 'tax_code', 'warehouse_id', 'branch_id'];

    public function resolve(string $eventKey, array $context = []): AccountRef
    {
        $rule = $this->match($eventKey, $context);

        if ($rule === null) {
            throw new AccountNotDetermined($eventKey);
        }

        return new AccountRef($rule->account->id, $rule->account->code, $rule->account->name, $rule->side?->value, $rule->id);
    }

    /**
     * @param  array<string, string|int|null>  $context
     */
    public function match(string $eventKey, array $context): ?AccountDeterminationRule
    {
        $keys = self::candidateKeys($eventKey);
        $rules = AccountDeterminationRule::query()->with('account')
            ->whereIn('event_key', $keys)->where('is_active', true)
            ->get()
            ->filter(fn (AccountDeterminationRule $r): bool => $r->account->is_active && $r->account->is_postable && self::matches($r->conditions, $context))
            ->sort(static function (AccountDeterminationRule $a, AccountDeterminationRule $b) use ($eventKey): int {
                return [$b->priority, $b->event_key === $eventKey, count($b->conditions), $a->id]
                    <=> [$a->priority, $a->event_key === $eventKey, count($a->conditions), $b->id];
            });

        return $rules->first();
    }

    /**
     * @param  array<string, mixed>  $conditions
     * @param  array<string, string|int|null>  $context
     */
    public static function matches(array $conditions, array $context): bool
    {
        foreach ($conditions as $key => $expected) {
            $actual = $context[$key] ?? null;

            if ($actual === null) {
                return false;
            }

            $allowed = is_array($expected) ? array_map('strval', $expected) : [is_scalar($expected) ? (string) $expected : ''];

            if (! in_array((string) $actual, $allowed, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * "a.b.c" -> ["a.b.c", "a.b.*", "a.*"].
     *
     * @return list<string>
     */
    public static function candidateKeys(string $eventKey): array
    {
        $keys = [$eventKey];
        $parts = explode('.', $eventKey);

        for ($i = count($parts) - 1; $i >= 1; $i--) {
            $keys[] = implode('.', array_slice($parts, 0, $i)).'.*';
        }

        return $keys;
    }
}
