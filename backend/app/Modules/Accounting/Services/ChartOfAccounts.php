<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\NormalBalance;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Support\AccountingSettings;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\Messages;
use App\Modules\Reference\Contracts\CurrencyLookup;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Chart of accounts writes. Only leaves are postable: adding a sub-account under a postable account
 * moves postability down (allowed only while the parent has no journal lines). Tree writes take a
 * per-company advisory lock; the database triggers repeat the tree and usage rules.
 */
final class ChartOfAccounts
{
    public function __construct(
        private readonly AccountingSettings $settings,
        private readonly CurrencyLookup $currencies,
    ) {}

    /**
     * @param  array<string, mixed>  $data  Account::EDITABLE plus parent_id or parent_code
     */
    public function create(array $data, bool $system = false): Account
    {
        return $this->transaction(function () use ($data, $system): Account {
            Ledger::lock('accounts');
            $parent = $this->parent($data);
            $code = is_string($data['code'] ?? null) ? $data['code'] : '';

            $this->assertCodeFitsParent($code, $parent);
            $this->assertCurrency($data['currency_code'] ?? null);

            $account = new Account(array_intersect_key($data, array_flip(Account::EDITABLE)));
            $account->id = (string) Str::uuid7();
            $account->is_system = $system;
            $account->type ??= $parent->type ?? Messages::fail('type', 'account_type_required');
            $account->normal_balance ??= $parent->normal_balance ?? self::normalBalanceFor($account->type);
            $account->tdhp_group ??= $parent->tdhp_group ?? self::groupOf($code);

            if ($parent !== null) {
                $this->makeParent($parent);
                $account->parent_id = $parent->id;
                $account->level = $parent->level + 1;
            }

            $account->save();

            return $account;
        });
    }

    /**
     * @param  array<string, mixed>  $data  Account::EDITABLE plus parent_id
     */
    public function update(Account $account, array $data, int $version): Account
    {
        return $this->transaction(function () use ($account, $data, $version): Account {
            Ledger::lock('accounts');
            $locked = Account::query()->whereKey($account->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);
            $used = self::used($locked->id);

            if (array_key_exists('currency_code', $data) && $data['currency_code'] !== $locked->currency_code) {
                if ($used) {
                    Messages::fail('currency_code', 'account_currency_locked');
                }
                $this->assertCurrency($data['currency_code']);
            }

            if (isset($data['is_postable']) && $data['is_postable'] === true && $locked->children()->exists()) {
                Messages::fail('is_postable', 'account_has_children');
            }

            if (isset($data['is_postable']) && $data['is_postable'] === false && $locked->is_postable && self::used($locked->id, bookedOnly: true)) {
                Messages::fail('is_postable', 'account_in_use');
            }

            $parent = $locked->parent;

            if (array_key_exists('parent_id', $data) && $data['parent_id'] !== $locked->parent_id) {
                $parent = $this->parent(['parent_id' => $data['parent_id']]);
                $this->move($locked, $parent);
            }

            $code = is_string($data['code'] ?? null) ? $data['code'] : $locked->code;

            if ($code !== $locked->code || array_key_exists('parent_id', $data)) {
                if ($code !== $locked->code && $locked->children()->exists() && $this->settings->codePrefixRule()) {
                    Messages::fail('code', 'account_code_has_children');
                }
                $this->assertCodeFitsParent($code, $parent);
            }

            $locked->fill(array_intersect_key($data, array_flip(Account::EDITABLE)));
            $locked->save();

            return $locked;
        });
    }

    public function delete(Account $account, ?int $version): void
    {
        Ledger::transaction(function () use ($account, $version): void {
            Ledger::lock('accounts');
            $locked = Account::query()->whereKey($account->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $locked->assertVersion($version);
            }

            if ($locked->is_system) {
                Messages::fail('account', 'account_system');
            }

            if ($locked->children()->exists()) {
                Messages::fail('account', 'account_has_children');
            }

            if (self::used($locked->id) || AccountDeterminationRule::query()->where('account_id', $locked->id)->exists()) {
                Messages::fail('account', 'account_in_use');
            }

            $locked->delete();
        });
    }

    /** The account has journal lines (any, or only of booked entries). */
    public static function used(string $accountId, bool $bookedOnly = false): bool
    {
        return DB::table('journal_lines as l')
            ->when($bookedOnly, fn ($q) => $q->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->where('e.status', '<>', EntryStatus::Draft->value))
            ->where('l.account_id', $accountId)
            ->exists();
    }

    public static function normalBalanceFor(AccountType $type): NormalBalance
    {
        return in_array($type, [AccountType::Liability, AccountType::Equity, AccountType::Revenue], true)
            ? NormalBalance::Credit
            : NormalBalance::Debit;
    }

    /** TDHP group from the first digit of a numeric code. */
    public static function groupOf(string $code): ?int
    {
        $first = substr($code, 0, 1);

        return $first !== '' && ctype_digit($first) && $first !== '0' ? (int) $first : null;
    }

    /**
     * A postable parent becomes a heading account, unless it already carries lines.
     */
    private function makeParent(Account $parent): void
    {
        if (! $parent->is_postable) {
            return;
        }

        if (self::used($parent->id)) {
            Messages::fail('parent_id', 'parent_in_use', ['code' => $parent->code]);
        }

        $parent->is_postable = false;
        $parent->save();
    }

    private function move(Account $account, ?Account $parent): void
    {
        if ($parent !== null) {
            $isDescendant = DB::selectOne(<<<'SQL'
                WITH RECURSIVE up AS (
                    SELECT id, parent_id FROM accounts WHERE id = ?
                    UNION
                    SELECT a.id, a.parent_id FROM accounts a JOIN up ON a.id = up.parent_id
                )
                SELECT EXISTS (SELECT 1 FROM up WHERE id = ?) AS hit
                SQL, [$parent->id, $account->id]);

            if (is_object($isDescendant) && isset($isDescendant->hit) && $isDescendant->hit === true) {
                Messages::fail('parent_id', 'account_cycle');
            }

            $this->makeParent($parent);
        }

        $account->parent_id = $parent?->id;
        $account->level = ($parent === null ? 0 : $parent->level) + 1;

        // Descendant levels follow; the subtree is walked from the moved account down.
        DB::update(<<<'SQL'
            WITH RECURSIVE t AS (
                SELECT id, ?::int AS lvl FROM accounts WHERE parent_id = ?
                UNION ALL
                SELECT a.id, t.lvl + 1 FROM accounts a JOIN t ON a.parent_id = t.id
            )
            UPDATE accounts SET level = t.lvl FROM t WHERE accounts.id = t.id AND accounts.level <> t.lvl
            SQL, [$account->level + 1, $account->id]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function parent(array $data): ?Account
    {
        $id = $data['parent_id'] ?? null;
        $code = $data['parent_code'] ?? null;

        if ($id === null && ($code === null || $code === '')) {
            return null;
        }

        $parent = is_string($id) && Str::isUuid($id)
            ? Account::query()->whereKey($id)->lockForUpdate()->first()
            : (is_string($code) && $id === null ? Account::query()->where('code', $code)->lockForUpdate()->first() : null);

        return $parent ?? Messages::fail('parent_id', 'parent_missing');
    }

    private function assertCodeFitsParent(string $code, ?Account $parent): void
    {
        if ($parent === null || ! $this->settings->codePrefixRule()) {
            return;
        }

        if (! str_starts_with($code, $parent->code) || strlen($code) <= strlen($parent->code)) {
            Messages::fail('code', 'account_code_prefix', ['parent' => $parent->code]);
        }
    }

    private function assertCurrency(mixed $currency): void
    {
        if ($currency !== null && (! is_string($currency) || ! $this->currencies->exists($currency))) {
            Messages::fail('currency_code', 'currency_missing');
        }
    }

    /**
     * @template T
     *
     * @param  \Closure(): T  $fn
     * @return T
     */
    private function transaction(\Closure $fn): mixed
    {
        try {
            return Ledger::transaction($fn);
        } catch (UniqueConstraintViolationException $e) {
            if (str_contains($e->getMessage(), 'accounts_company_id_code_unique')) {
                Messages::fail('code', 'account_code_taken');
            }

            throw $e;
        }
    }
}
