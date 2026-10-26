<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Contracts\JournalPartyAccountLookup;
use App\Modules\Accounting\Data\AccountRef;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

final class JournalPartyAccounts implements JournalPartyAccountLookup
{
    public function findMany(array $requests): array
    {
        if ($requests === []) {
            return [];
        }if (count($requests) > 500) {
            throw new \InvalidArgumentException('At most 500 journal references per batch.');
        }$company = app(CompanyContext::class)->id();
        $rows = DB::table('journal_lines as l')->join('journal_entries as e', fn ($join) => $join->on('e.id', '=', 'l.entry_id')->where('e.company_id', $company))->join('accounts as a', fn ($join) => $join->on('a.id', '=', 'l.account_id')->where('a.company_id', $company))->where('l.company_id', $company)->whereIn('l.entry_id', array_keys($requests))->whereIn('l.party_id', array_unique(array_column($requests, 'party_id')))->whereIn('e.status', ['posted', 'reversed'])->select(['l.entry_id', 'l.party_id', 'l.account_id', 'l.debit', 'l.credit', 'a.code', 'a.name'])->get();
        $groups = [];
        foreach ($rows as $row) {
            $request = $requests[(string) $row->entry_id];
            if ($row->party_id !== $request['party_id']) {
                continue;
            }$side = $request['side'];
            if (! in_array($side, ['debit', 'credit'], true)) {
                throw new \InvalidArgumentException('Unknown journal side.');
            }$amount = BigDecimal::of((string) $row->{$side});
            if (! $amount->isPositive()) {
                continue;
            }$key = $row->entry_id.'|'.$row->account_id;
            if (! isset($groups[$key])) {
                $groups[$key] = ['entry' => (string) $row->entry_id, 'account' => new AccountRef((string) $row->account_id, (string) $row->code, (string) $row->name), 'amount' => BigDecimal::zero()];
            }$groups[$key]['amount'] = $groups[$key]['amount']->plus($amount);
        }
        $found = [];
        $ambiguous = [];
        foreach ($groups as $group) {
            $id = $group['entry'];
            if (! $group['amount']->isEqualTo($requests[$id]['amount'])) {
                continue;
            }if (isset($found[$id])) {
                $ambiguous[$id] = true;
            }$found[$id] = $group['account'];
        }foreach ($ambiguous as $id => $unused) {
            unset($found[$id]);
        }

        return $found;
    }
}
