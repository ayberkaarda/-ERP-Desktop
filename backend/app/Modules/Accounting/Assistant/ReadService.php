<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Assistant;

use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Services\BalanceBook;
use DateTimeImmutable;

final class ReadService
{
    /** @return array<string, mixed> */
    public function search(string $query): array
    {
        $d = ['query' => $query];
        $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $d['query']);
        $rows = Account::query()->where('is_active', true)->where(fn ($q) => $q->where('code', 'ilike', '%'.$term.'%')->orWhere('name', 'ilike', '%'.$term.'%'))->orderBy('code')->limit(21)->get();

        return ['has_more' => $rows->count() > 20, 'accounts' => $rows->take(20)->map(static fn (Account $a): array => ['id' => $a->id, 'code' => $a->code, 'name' => $a->name, 'is_postable' => $a->is_postable, 'currency_code' => $a->currency_code, 'requires_party' => $a->requires_party, 'requires_cost_center' => $a->requires_cost_center, 'requires_project' => $a->requires_project])->values()->all()];
    }

    /** @return array<string, mixed> */
    public function balance(string $accountCode, string $asOf): array
    {
        $d = ['account_code' => $accountCode, 'as_of' => $asOf];
        $account = Account::query()->where('code', $d['account_code'])->firstOrFail();
        $totals = app(BalanceBook::class)->accountAsOf($account->id, new DateTimeImmutable((string) $d['as_of']), $account->currency_code);

        return ['id' => $account->id, 'code' => $account->code, 'name' => $account->name, 'as_of' => $d['as_of'], 'debit' => (string) $totals['debit'], 'credit' => (string) $totals['credit'], 'balance' => (string) $totals['balance'], 'fx_balance' => $totals['fx_balance'] === null ? null : (string) $totals['fx_balance'], 'currency_code' => $account->currency_code];
    }
}
