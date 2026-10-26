<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Reports\Services;

use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Contracts\TreasuryInvoiceAccess;
use App\Modules\Treasury\Reports\Support\Table;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

final class TreasuryReports
{
    public const array NAMES = ['cash-flow', 'account-balances', 'receivables-ageing', 'payables-ageing', 'payment-forecast', 'instrument-portfolio', 'reconciliation-status'];

    /** @param array<string, mixed> $filters */
    public function table(string $name, array $filters, int $offset, int $limit, bool $export = false): Table
    {
        $asOf = (string) ($filters['as_of'] ?? now()->toDateString());
        $from = (string) ($filters['date_from'] ?? substr($asOf, 0, 4).'-01-01');
        $to = (string) ($filters['date_to'] ?? $asOf);
        if ($from > $to) {
            Extension::fail('date_to', 'invalid_date');
        }
        if (in_array($name, ['payment-forecast', 'reconciliation-status'], true) && $asOf !== now()->toDateString()) {
            Extension::fail('as_of', 'historical_not_supported');
        }
        if (in_array($name, ['receivables-ageing', 'payables-ageing'], true)) {
            return $this->ageing($name === 'receivables-ageing' ? 'sales' : 'purchasing', $asOf, $filters, $offset, $limit, $export);
        }
        $query = match ($name) {
            'cash-flow' => $this->cashFlow($from, $to, $filters),
            'account-balances' => $this->balances($asOf, $filters),
            'payment-forecast' => $this->forecast($from, $to, $filters),
            'instrument-portfolio' => $this->portfolio($asOf, $filters),
            'reconciliation-status' => $this->reconciliation($from, $to, $filters),
            default => abort(404),
        };
        $count = DB::query()->fromSub(clone $query, 'counted')->count();
        if ($export && $count > 50000) {
            Extension::fail('export', 'export_too_large');
        }
        $rows = array_values((clone $query)->offset($offset)->limit($limit)->get()->map(static fn (object $row): array => (array) $row)->all());

        return new Table($rows, $count, ['as_of' => $asOf, 'date_from' => $from, 'date_to' => $to]);
    }

    /** @param array<string, mixed> $filters */
    private function cashFlow(string $from, string $to, array $filters): Builder
    {
        $query = DB::table('treasury_movements as m')->where('m.company_id', Extension::company())->whereBetween('m.document_date', [$from, $to]);
        $this->accountFilters($query, $filters, 'm');

        return $query->select(['m.document_date', 'm.account_id', 'm.currency_code'])
            ->selectRaw('sum(CASE WHEN m.amount > 0 THEN m.amount ELSE 0 END)::numeric(20,4)::text AS inflow, sum(CASE WHEN m.amount < 0 THEN -m.amount ELSE 0 END)::numeric(20,4)::text AS outflow, sum(m.amount)::numeric(20,4)::text AS net_amount, sum(m.local_amount)::numeric(20,4)::text AS net_local')
            ->groupBy('m.document_date', 'm.account_id', 'm.currency_code')->orderBy('m.document_date')->orderBy('m.account_id');
    }

    /** @param array<string, mixed> $filters */
    private function balances(string $asOf, array $filters): Builder
    {
        $query = DB::table('treasury_accounts as a')->leftJoin('treasury_movements as m', function ($join) use ($asOf): void {
            $join->on('m.account_id', '=', 'a.id')->on('m.company_id', '=', 'a.company_id')->where('m.document_date', '<=', $asOf);
        })->where('a.company_id', Extension::company());
        if (isset($filters['account_id'])) {
            $query->where('a.id', $filters['account_id']);
        }
        if (isset($filters['currency_code'])) {
            $query->where('a.currency_code', $filters['currency_code']);
        }

        return $query->select(['a.id as account_id', 'a.code', 'a.name', 'a.type', 'a.currency_code'])
            ->selectRaw('coalesce(sum(m.amount),0)::numeric(20,4)::text AS balance, coalesce(sum(m.local_amount),0)::numeric(20,4)::text AS balance_local')
            ->groupBy('a.id', 'a.code', 'a.name', 'a.type', 'a.currency_code')->orderBy('a.code');
    }

    /** @param array<string, mixed> $filters */
    private function forecast(string $from, string $to, array $filters): Builder
    {
        $query = DB::table('treasury_payment_plans as p')->where('p.company_id', Extension::company())->where('p.status', 'scheduled')->whereBetween('p.due_date', [$from, $to]);
        $this->accountFilters($query, $filters, 'p');
        if (isset($filters['party_id'])) {
            $query->where('p.party_id', $filters['party_id']);
        }

        return $query->select(['p.id', 'p.due_date', 'p.party_id', 'p.account_id', 'p.direction', 'p.currency_code', 'p.amount', 'p.description'])->orderBy('p.due_date')->orderBy('p.id');
    }

    /** @param array<string, mixed> $filters */
    private function portfolio(string $asOf, array $filters): Builder
    {
        $history = DB::table('treasury_instrument_events as e')->where('e.company_id', Extension::company())->where('e.document_date', '<=', $asOf)
            ->whereColumn('e.instrument_id', 'i.id')->whereColumn('e.company_id', 'i.company_id')->orderByDesc('e.sequence')->limit(1)->select('e.to_status');
        $lines = DB::table('treasury_instruments as i')->where('i.company_id', Extension::company())->select(['i.id', 'i.kind', 'i.direction', 'i.currency_code', 'i.amount', 'i.local_amount', 'i.due_date', 'i.party_id'])->selectSub($history, 'status');
        if (isset($filters['party_id'])) {
            $lines->where('i.party_id', $filters['party_id']);
        }
        if (isset($filters['currency_code'])) {
            $lines->where('i.currency_code', $filters['currency_code']);
        }

        return DB::query()->fromSub($lines, 'portfolio')->whereIn('status', ['portfolio', 'issued', 'collection', 'pledged', 'endorsed'])
            ->select(['kind', 'direction', 'status', 'currency_code'])->selectRaw('count(*)::integer AS instrument_count, sum(amount)::numeric(20,4)::text AS amount, sum(local_amount)::numeric(20,4)::text AS amount_local')
            ->groupBy('kind', 'direction', 'status', 'currency_code')->orderBy('kind')->orderBy('direction')->orderBy('status')->orderBy('currency_code');
    }

    /** @param array<string, mixed> $filters */
    private function reconciliation(string $from, string $to, array $filters): Builder
    {
        $query = DB::table('treasury_bank_statements as s')->leftJoin('treasury_bank_statement_lines as l', function ($join): void {
            $join->on('l.statement_id', '=', 's.id')->on('l.company_id', '=', 's.company_id');
        })->where('s.company_id', Extension::company())->whereBetween('s.end_date', [$from, $to]);
        $this->accountFilters($query, $filters, 's');

        return $query->select(['s.id', 's.account_id', 's.bank_reference', 's.currency_code', 's.start_date', 's.end_date', 's.status', 's.opening_balance', 's.closing_balance'])
            ->selectRaw('count(l.id)::integer AS line_count, count(l.movement_id)::integer AS matched_count, count(l.id) FILTER (WHERE l.movement_id IS NULL)::integer AS unmatched_count')
            ->groupBy('s.id', 's.account_id', 's.bank_reference', 's.currency_code', 's.start_date', 's.end_date', 's.status', 's.opening_balance', 's.closing_balance')->orderBy('s.end_date')->orderBy('s.id');
    }

    /** @param array<string, mixed> $filters */
    private function accountFilters(Builder $query, array $filters, string $alias): void
    {
        if (isset($filters['account_id'])) {
            $query->where($alias.'.account_id', $filters['account_id']);
        }
        if (isset($filters['currency_code'])) {
            $query->where($alias.'.currency_code', $filters['currency_code']);
        }
    }

    /** @param array<string, mixed> $filters */
    private function ageing(string $module, string $asOf, array $filters, int $offset, int $limit, bool $export): Table
    {
        $all = [];
        $totals = [];
        for ($page = 1; ; $page++) {
            $batch = app(TreasuryInvoiceAccess::class)->openForCompany($module, $page, 500, $asOf);
            foreach ($batch as $invoice) {
                if (isset($filters['party_id']) && $invoice->partyId !== $filters['party_id'] || isset($filters['currency_code']) && $invoice->currencyCode !== $filters['currency_code']) {
                    continue;
                }
                if (count($all) >= 50000) {
                    Extension::fail('export', 'export_too_large');
                }
                $due = $invoice->dueDate ?? $invoice->documentDate;
                $days = (int) (new DateTimeImmutable($due))->diff(new DateTimeImmutable($asOf))->format('%r%a');
                $bucket = match (true) {
                    $days < 0 => 'not_due', $days <= 30 => 'days_0_30', $days <= 60 => 'days_31_60', $days <= 90 => 'days_61_90', default => 'days_over_90',
                };
                $sign = $invoice->invoiceType === 'return' ? -1 : 1;
                $balance = BigDecimal::of($invoice->balanceDue)->multipliedBy($sign);
                if ($invoice->balanceLocal === null) {
                    throw new \LogicException('Invoice lookup must expose historical remaining carrying amount.');
                }
                $local = BigDecimal::of($invoice->balanceLocal)->multipliedBy($sign);
                $row = ['invoice_id' => $invoice->id, 'number' => $invoice->number, 'invoice_type' => $invoice->invoiceType, 'party_id' => $invoice->partyId,
                    'party_name' => $invoice->partyName, 'document_date' => $invoice->documentDate, 'due_date' => $due, 'currency_code' => $invoice->currencyCode,
                    'balance' => Extension::money((string) $balance), 'balance_local' => Extension::money((string) $local), 'days_overdue' => $days, 'bucket' => $bucket];
                foreach (['not_due', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90'] as $column) {
                    $row[$column] = $column === $bucket ? Extension::money((string) $balance) : '0.0000';
                }
                $all[] = $row;
                $totals[$invoice->currencyCode] = Extension::money((string) BigDecimal::of($totals[$invoice->currencyCode] ?? '0')->plus($balance));
            }
            if (count($batch) < 500) {
                break;
            }
            // Bound contract traversal even if a filter excludes all rows.
            if ($page >= 100) {
                if (app(TreasuryInvoiceAccess::class)->openForCompany($module, 50001, 1, $asOf) !== []) {
                    Extension::fail('report', 'scan_too_large');
                }
                break;
            }
        }

        return new Table(array_slice($all, $offset, $limit), count($all), ['as_of' => $asOf, 'by_currency' => $totals]);
    }
}
