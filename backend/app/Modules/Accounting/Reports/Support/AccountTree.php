<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Support;

use App\Modules\Accounting\Models\Account;

/**
 * The chart of accounts of the active company in code order, with parent links for roll-ups.
 */
final class AccountTree
{
    /** @var array<string, Account> */
    private array $accounts = [];

    /** @var array<string, list<string>> */
    private array $children = [];

    public function __construct()
    {
        $accounts = Account::query()->orderBy('code')
            ->get(['id', 'company_id', 'code', 'name', 'parent_id', 'level', 'type', 'normal_balance', 'is_postable', 'is_active', 'tdhp_group']);

        foreach ($accounts as $account) {
            $this->accounts[$account->id] = $account;

            if ($account->parent_id !== null) {
                $this->children[$account->parent_id][] = $account->id;
            }
        }
    }

    /** @return array<string, Account> in code order */
    public function all(): array
    {
        return $this->accounts;
    }

    public function get(string $id): ?Account
    {
        return $this->accounts[$id] ?? null;
    }

    /**
     * The account and its ancestors, nearest first.
     *
     * @return list<string>
     */
    public function selfAndAncestors(string $id): array
    {
        $ids = [];
        $seen = [];

        while (isset($this->accounts[$id]) && ! isset($seen[$id])) {
            $ids[] = $id;
            $seen[$id] = true;
            $parent = $this->accounts[$id]->parent_id;

            if ($parent === null) {
                break;
            }

            $id = $parent;
        }

        return $ids;
    }

    /**
     * The account and all its descendants.
     *
     * @return list<string>
     */
    public function selfAndDescendants(string $id): array
    {
        $seen = [];
        $stack = [$id];

        while ($stack !== []) {
            $current = array_pop($stack);

            if (isset($seen[$current])) {
                continue;
            }

            $seen[$current] = true;
            array_push($stack, ...($this->children[$current] ?? []));
        }

        return array_map('strval', array_keys($seen));
    }
}
