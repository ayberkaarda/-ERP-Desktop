<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Parties\Contracts\IbanValidation;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Treasury\Contracts\PaymentReversalGuard;
use App\Modules\Treasury\Contracts\TreasuryAccountLookup;
use App\Modules\Treasury\Contracts\TreasuryMovementLookup;
use App\Modules\Treasury\Contracts\TreasuryMovementWriter;
use App\Modules\Treasury\Contracts\TreasuryPaymentLookup;
use App\Modules\Treasury\Data\TreasuryAccountData;
use App\Modules\Treasury\Data\TreasuryMovementData;
use App\Modules\Treasury\Enums\AccountType;
use App\Modules\Treasury\Models\TreasuryAccount;
use App\Modules\Treasury\Support\Treasury;
use App\Modules\Treasury\Support\TreasurySettings;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

final class AccountService implements TreasuryAccountLookup, TreasuryMovementLookup, TreasuryMovementWriter
{
    public function find(string $id): ?TreasuryAccountData
    {
        $a = Str::isUuid($id) ? TreasuryAccount::query()->find($id) : null;

        return $a === null ? null : $this->data($a);
    }

    public function balance(string $accountId, ?string $asOf = null): string
    {
        $this->account($accountId);
        $asOf ??= now()->toDateString();

        $value = DB::table('treasury_movements')->where('company_id', app(CompanyContext::class)->id())->where('account_id', $accountId)->where('document_date', '<=', $asOf)->selectRaw('coalesce(sum(amount),0)::text AS balance')->value('balance');
        if (! is_string($value)) {
            throw new \LogicException('PostgreSQL numeric aggregate must be a decimal string.');
        }

        return Treasury::money($value);
    }

    /** @return list<TreasuryMovementData> */
    public function movements(string $accountId, string $from, string $to, int $page = 1, int $perPage = 100): array
    {
        $this->account($accountId);

        return array_values(DB::table('treasury_movements')->where('company_id', app(CompanyContext::class)->id())->where('account_id', $accountId)->whereBetween('document_date', [$from, $to])->orderBy('document_date')->orderBy('id')->offset((max(1, $page) - 1) * min(500, max(1, $perPage)))->limit(min(500, max(1, $perPage)))->get()->map(fn ($row): TreasuryMovementData => $this->movement((array) $row))->all());
    }

    /** @param array<string,mixed> $input */
    public function save(?TreasuryAccount $account, array $input, ?int $version): TreasuryAccount
    {
        return DB::transaction(function () use ($account, $input, $version): TreasuryAccount {
            if ($account !== null) {
                $account = $this->account((string) $account->getKey(), true);
                $account->assertVersion($version ?? 0);
                if ($this->used($account)) {
                    foreach (['type', 'currency_code', 'gl_account_id', 'code'] as $field) {
                        if (isset($input[$field]) && $input[$field] !== $account->getAttribute($field)) {
                            Treasury::fail($field, 'account_used');
                        }
                    }
                }
            } else {
                $account = new TreasuryAccount;
            }
            $data = [...$account->getAttributes(), ...$input];
            $gl = app(AccountLookup::class)->find((string) ($data['gl_account_id'] ?? ''));
            $prefix = match ($data['type'] ?? '') {
                AccountType::Cash->value => ['100'],AccountType::Bank->value => ['102'],AccountType::Pos->value => ['102', '108'],default => []
            };
            if ($gl === null || ! $gl->isActive || ! $gl->isPostable || $gl->requiresParty || $gl->requiresCostCenter || $gl->requiresProject || ! in_array(substr($gl->code, 0, 3), $prefix, true)) {
                Treasury::fail('gl_account_id', 'account_invalid');
            }
            if (! app(CurrencyLookup::class)->exists((string) ($data['currency_code'] ?? ''))) {
                Treasury::fail('currency_code', 'currency_invalid');
            }
            if ($gl->currencyCode !== null && $gl->currencyCode !== ($data['currency_code'] ?? null)) {
                Treasury::fail('gl_account_id', 'currency_invalid');
            }
            if (isset($input['iban']) && $input['iban'] !== '') {
                $input['iban'] = strtoupper(str_replace(' ', '', (string) $input['iban']));
                if (! app(IbanValidation::class)->isValid($input['iban'])) {
                    Treasury::fail('iban', 'iban_invalid');
                }
            }
            if (isset($input['code']) && TreasuryAccount::query()->where('code', $input['code'])->when($account->exists, fn ($q) => $q->where('id', '<>', $account->id))->exists()) {
                Treasury::fail('code', 'duplicate');
            }
            if ($account->exists && ($input['allow_negative'] ?? null) === false && Treasury::decimal($this->balance($account->id))->isNegative()) {
                Treasury::fail('allow_negative', 'insufficient');
            }
            $account->fill($input);
            $account->save();

            return $account->refresh();
        });
    }

    public function delete(TreasuryAccount $account, int $version): void
    {
        DB::transaction(function () use ($account, $version): void {
            $a = $this->account($account->id, true);
            $a->assertVersion($version);
            if ($this->used($a)) {
                Treasury::fail('account_id', 'account_used');
            }
            $a->delete();
        });
    }

    public function account(string $id, bool $lock = false): TreasuryAccount
    {
        $q = TreasuryAccount::query();
        if ($lock) {
            $q->lockForUpdate();
        }
        $a = Str::isUuid($id) ? $q->find($id) : null;
        if ($a === null) {
            Treasury::fail('account_id', 'unknown');
        }

        return $a;
    }

    public function record(string $accountId, string $sourceType, string $sourceId, string $date, string $amount, string $localAmount, string $journalEntryId, ?string $reversesId = null): TreasuryMovementData
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Treasury movements require a posting transaction.');
        }
        $a = $this->account($accountId, true);
        $existing = DB::table('treasury_movements')->where('company_id', $a->company_id)->where('account_id', $a->id)->where('source_type', $sourceType)->where('source_id', $sourceId)->first();
        if ($existing !== null) {
            if (! Treasury::decimal((string) $existing->amount)->isEqualTo($amount) || ! Treasury::decimal((string) $existing->local_amount)->isEqualTo($localAmount) || (string) $existing->document_date !== $date || $existing->reverses_id !== $reversesId || (string) $existing->journal_entry_id !== $journalEntryId) {
                Treasury::fail('reference', 'duplicate');
            }

            return $this->movement((array) $existing);
        }
        if (! $a->getAttribute('is_active')) {
            Treasury::fail('account_id', 'inactive');
        }
        if ($reversesId !== null) {
            $original = DB::table('treasury_movements')->where('company_id', $a->company_id)->where('id', $reversesId)->lockForUpdate()->first();
            if ($original === null || (string) $original->account_id !== $accountId || $original->reverses_id !== null || ! Treasury::decimal((string) $original->amount)->negated()->isEqualTo($amount) || ! Treasury::decimal((string) $original->local_amount)->negated()->isEqualTo($localAmount) || DB::table('treasury_movements')->where('company_id', $a->company_id)->where('reverses_id', $reversesId)->exists()) {
                Treasury::fail('reverses_id', 'transition');
            }app(PaymentReversalGuard::class)->assertMovementUnmatched($reversesId);
        }
        $value = Treasury::decimal($amount);
        if ($value->isZero() || Treasury::decimal($localAmount)->isZero() || $value->isPositive() !== Treasury::decimal($localAmount)->isPositive()) {
            Treasury::fail('amount', 'positive');
        }
        if (! $a->getAttribute('allow_negative') && ($this->minimumBalanceAfter($a->id, $date, $value))->isNegative()) {
            Treasury::fail('amount', 'insufficient');
        }
        $row = ['id' => (string) Str::uuid7(), 'company_id' => $a->company_id, 'account_id' => $a->id, 'document_date' => $date, 'amount' => Treasury::money($value), 'local_amount' => Treasury::money($localAmount), 'currency_code' => $a->getAttribute('currency_code'), 'source_type' => $sourceType, 'source_id' => $sourceId, 'journal_entry_id' => $journalEntryId, 'reverses_id' => $reversesId, 'created_at' => now(), 'updated_at' => now()];
        DB::table('treasury_movements')->insert($row);

        return $this->movement($row);
    }

    private function minimumBalanceAfter(string $accountId, string $date, BigDecimal $delta): BigDecimal
    {
        $balance = Treasury::decimal($this->balance($accountId, $date))->plus($delta);
        $minimum = $balance;
        $days = DB::table('treasury_movements')->where('company_id', app(CompanyContext::class)->id())->where('account_id', $accountId)->where('document_date', '>', $date)->selectRaw('document_date, sum(amount) AS amount')->groupBy('document_date')->orderBy('document_date')->get();
        foreach ($days as $day) {
            $balance = $balance->plus((string) $day->amount);
            if ($balance->isLessThan($minimum)) {
                $minimum = $balance;
            }
        }

        return $minimum;
    }

    /** @param array<string,mixed> $input */
    public function opening(string $id, array $input, ?string $actor): TreasuryAccount
    {
        return DB::transaction(function () use ($id, $input, $actor): TreasuryAccount {
            $a = $this->account($id, true);
            $a->assertVersion((int) $input['version']);
            if (DB::table('treasury_movements')->where('company_id', $a->company_id)->where('account_id', $id)->exists()) {
                Treasury::fail('account_id', 'account_used');
            }
            $offset = app(AccountLookup::class)->find((string) $input['offset_account_id']);
            if ($offset === null || ! $offset->isActive || ! $offset->isPostable || $offset->id === $a->getAttribute('gl_account_id') || $offset->requiresParty || $offset->requiresCostCenter || $offset->requiresProject) {
                Treasury::fail('offset_account_id', 'account_invalid');
            }
            $rate = app(TreasurySettings::class)->rate((string) $a->getAttribute('currency_code'), (string) $input['document_date'], isset($input['fx_rate']) ? (string) $input['fx_rate'] : null);
            $local = Treasury::local(Treasury::decimal((string) $input['amount'])->multipliedBy($rate));
            if (! Treasury::decimal($local)->isPositive()) {
                Treasury::fail('amount', 'positive');
            }
            $extra = ['currency' => (string) $a->getAttribute('currency_code'), 'fxAmount' => (string) $input['amount'], 'fxRate' => $rate];
            $journal = app(PostingService::class)->post(new PostingRequest($a->company_id, new DateTimeImmutable((string) $input['document_date']), EntryType::Opening, (string) $input['reason'], 'treasury_opening', $id, [PostingLine::debit((string) $a->getAttribute('gl_account_id'), $local, $extra), PostingLine::credit($offset->id, $local)], postedBy: $actor));
            $this->record($id, 'treasury_opening', $id, (string) $input['document_date'], (string) $input['amount'], $local, $journal->id);
            $a->bumpVersion()->save();

            return $a;
        });
    }

    private function data(TreasuryAccount $a): TreasuryAccountData
    {
        return new TreasuryAccountData($a->id, $a->company_id, (string) $a->getAttribute('type'), (string) $a->getAttribute('code'), (string) $a->getAttribute('name'), (string) $a->getAttribute('currency_code'), (string) $a->getAttribute('gl_account_id'), (bool) $a->getAttribute('is_active'), (bool) $a->getAttribute('allow_negative'), $a->currentVersion(), $a->getAttribute('iban'));
    }

    /** @param array<string,mixed> $r */
    private function movement(array $r): TreasuryMovementData
    {
        return new TreasuryMovementData((string) $r['id'], (string) $r['company_id'], (string) $r['account_id'], (string) $r['document_date'], (string) $r['amount'], (string) $r['local_amount'], (string) $r['currency_code'], (string) $r['source_type'], (string) $r['source_id'], (string) $r['journal_entry_id'], isset($r['reverses_id']) ? (string) $r['reverses_id'] : null);
    }

    public function findForUpdate(string $id): ?TreasuryMovementData
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Movement locks require a transaction.');
        }
        if (! Str::isUuid($id)) {
            return null;
        }
        $company = app(CompanyContext::class)->id();
        $r = DB::table('treasury_movements')->where('company_id', $company)->where('id', $id)->lockForUpdate()->first();
        if ($r === null || $r->reverses_id !== null || DB::table('treasury_movements')->where('company_id', $company)->where('reverses_id', $id)->exists()) {
            return null;
        }

        return $this->movement((array) $r);
    }

    public function forPayment(string $paymentId): ?TreasuryMovementData
    {
        if (app(TreasuryPaymentLookup::class)->find($paymentId) === null) {
            return null;
        }
        $r = DB::table('treasury_movements')->where('company_id', app(CompanyContext::class)->id())->where('source_type', 'treasury_payment')->where('source_id', $paymentId)->first();

        return $r === null ? null : $this->movement((array) $r);
    }

    private function used(TreasuryAccount $a): bool
    {
        foreach (['treasury_movements', 'treasury_payments', 'treasury_payment_plans', 'treasury_bank_statements'] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->where('company_id', $a->company_id)->where('account_id', $a->id)->exists()) {
                return true;
            }
        }

        return DB::table('treasury_transfers')->where('company_id', $a->company_id)->where(fn ($q) => $q->where('from_account_id', $a->id)->orWhere('to_account_id', $a->id))->exists();
    }
}
