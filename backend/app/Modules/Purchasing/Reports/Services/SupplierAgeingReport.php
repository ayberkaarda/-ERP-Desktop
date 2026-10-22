<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Payable ageing as of a date, rebuilt from booking, reversal and settlement data (not from the
 * current balance_due): an invoice counts when booked on or before as_of and not reversed by then;
 * its balance is the payable (total less withheld VAT) minus the settlements applied on or before
 * as_of and not unapplied by then (application days in the application time zone). Debit notes
 * count with a negative balance (separate documents, not applied to the invoices). Days overdue =
 * as_of - due date (document date when there is none); buckets: not_due (< 0), days_0_30,
 * days_31_60, days_61_90, days_over_90. Local amounts use the invoice's own rate (no revaluation):
 * the booked payable (total_local - withholding_total_local) while nothing is settled, otherwise
 * balance x fx_rate in cents. Groups: supplier (default, company currency), supplier_currency (the
 * original currency view: buckets in the invoice currency next to the local balance) or invoice;
 * largest balance first.
 */
final class SupplierAgeingReport
{
    public const array GROUPS = ['supplier', 'supplier_currency', 'invoice'];

    public const array BUCKETS = ['not_due', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90'];

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'invoice' => ['invoice_id', 'number', 'supplier_invoice_no', 'invoice_type', 'document_date', 'due_date', 'days_overdue', 'bucket',
                'party_id', 'party_code', 'party_name', 'currency_code', 'fx_rate', 'payable', 'settled_amount', 'balance', 'balance_local'],
            'supplier_currency' => ['party_id', 'party_code', 'party_name', 'currency_code', 'invoice_count', 'balance', ...self::BUCKETS, 'overdue',
                'balance_local', 'oldest_due_date'],
            default => ['party_id', 'party_code', 'party_name', 'invoice_count', 'balance_local', ...self::BUCKETS, 'overdue', 'oldest_due_date'],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $asOf = (string) $f->asOf;
        $invoices = [];
        $totals = array_fill_keys(self::BUCKETS, BigDecimal::zero());
        $totalLocal = BigDecimal::zero();

        foreach ($this->query($f, $asOf)->lazyById(1000, 'i.id', 'id') as $row) {
            $payable = Num::dec($row->total)->minus(Num::dec($row->withholding_total));
            $settled = Num::dec($row->settled);
            $balance = $payable->minus($settled);

            if ($balance->isZero()) {
                continue;
            }

            $sign = $row->invoice_type === InvoiceType::Return->value ? -1 : 1;
            $local = $settled->isZero()
                ? Num::dec($row->total_local)->minus(Num::dec($row->withholding_total_local))
                : Num::cents($balance->multipliedBy(Num::dec($row->fx_rate)));
            $due = is_string($row->due_date) ? $row->due_date : (string) $row->document_date;
            $days = self::days($due, $asOf);
            $bucket = self::bucket($days);
            $invoices[] = [
                'invoice_id' => (string) $row->id, 'number' => $row->number, 'supplier_invoice_no' => $row->supplier_invoice_no,
                'invoice_type' => (string) $row->invoice_type, 'document_date' => (string) $row->document_date, 'due_date' => $due,
                'days_overdue' => $days, 'bucket' => $bucket, 'party_id' => (string) $row->party_id, 'party_code' => null,
                'party_name' => (string) $row->party_name, 'currency_code' => (string) $row->currency_code, 'fx_rate' => Num::qty(Num::dec($row->fx_rate)),
                'payable' => Num::money($payable->multipliedBy($sign)), 'settled_amount' => Num::money($settled->multipliedBy($sign)),
                'balance' => Num::money($balance->multipliedBy($sign)), 'balance_local' => Num::money($local->multipliedBy($sign)),
            ];
            $totals[$bucket] = $totals[$bucket]->plus($local->multipliedBy($sign));
            $totalLocal = $totalLocal->plus($local->multipliedBy($sign));
        }

        $rows = $by === 'invoice'
            ? PurchaseGroupReport::sortBy($invoices, 'balance_local')
            : self::group($invoices, $by === 'supplier_currency');

        return new ReportTable($rows, self::columns($by), [
            'as_of' => $asOf,
            'group_by' => $by,
            'totals' => ['invoice_count' => count($invoices), 'balance_local' => Num::money($totalLocal),
                ...array_map(Num::money(...), $totals), 'overdue' => Num::money($totalLocal->minus($totals['not_due']))],
        ]);
    }

    private function query(ReportFilters $f, string $asOf): Builder
    {
        $tz = (string) config('app.timezone', 'UTC');
        $endOfDay = Carbon::parse($asOf, $tz)->addDay()->startOfDay();
        $settled = DB::table('purchase_payable_applications as a')
            ->whereColumn('a.invoice_id', 'i.id')
            ->where('a.company_id', $f->companyId)
            ->where('a.applied_at', '<', $endOfDay)
            ->where(fn (Builder $q) => $q->whereNull('a.unapplied_at')->orWhere('a.unapplied_at', '>=', $endOfDay))
            ->selectRaw('coalesce(sum(a.amount), 0)');

        return DB::table('purchase_invoices as i')
            ->where('i.company_id', $f->companyId)
            ->whereIn('i.status', [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])
            ->where('i.document_date', '<=', $asOf)
            ->where(fn (Builder $q) => $q->where('i.status', '<>', InvoiceStatus::Reversed->value)->orWhere('i.reversal_date', '>', $asOf))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('i.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('i.currency_code', $f->currencyCode))
            ->select(['i.id', 'i.number', 'i.supplier_invoice_no', 'i.invoice_type', 'i.document_date', 'i.due_date', 'i.party_id', 'i.party_name',
                'i.currency_code', 'i.fx_rate', 'i.total', 'i.withholding_total', 'i.total_local', 'i.withholding_total_local'])
            ->selectSub($settled, 'settled');
    }

    private static function days(string $due, string $asOf): int
    {
        $diff = (new DateTimeImmutable($due))->diff(new DateTimeImmutable($asOf));

        return $diff->invert === 1 ? -(int) $diff->days : (int) $diff->days;
    }

    private static function bucket(int $days): string
    {
        return match (true) {
            $days < 0 => 'not_due',
            $days <= 30 => 'days_0_30',
            $days <= 60 => 'days_31_60',
            $days <= 90 => 'days_61_90',
            default => 'days_over_90',
        };
    }

    /**
     * @param  list<array<string, string|int|null>>  $invoices
     * @return list<array<string, string|int|null>>
     */
    private static function group(array $invoices, bool $perCurrency): array
    {
        $groups = [];

        foreach ($invoices as $inv) {
            $key = (string) $inv['party_id'].($perCurrency ? '|'.$inv['currency_code'] : '');
            $amountKey = $perCurrency ? 'balance' : 'balance_local';
            $g = $groups[$key] ?? [
                'party_id' => $inv['party_id'], 'party_code' => null, 'party_name' => $inv['party_name'],
                ...($perCurrency ? ['currency_code' => $inv['currency_code'], 'balance' => '0.0000'] : []),
                'invoice_count' => 0, 'balance_local' => '0.0000', ...array_fill_keys(self::BUCKETS, '0.0000'), 'overdue' => '0.0000', 'oldest_due_date' => null,
            ];
            $amount = Num::dec($inv[$amountKey]);
            $g['invoice_count'] = (int) $g['invoice_count'] + 1;
            $g['balance_local'] = Num::money(Num::dec($g['balance_local'])->plus(Num::dec($inv['balance_local'])));

            if ($perCurrency) {
                $g['balance'] = Num::money(Num::dec($g['balance'])->plus($amount));
            }

            $bucket = (string) $inv['bucket'];
            $g[$bucket] = Num::money(Num::dec($g[$bucket])->plus($amount));

            if ($bucket !== 'not_due') {
                $g['overdue'] = Num::money(Num::dec($g['overdue'])->plus($amount));
            }

            if ($g['oldest_due_date'] === null || (string) $inv['due_date'] < (string) $g['oldest_due_date']) {
                $g['oldest_due_date'] = $inv['due_date'];
            }

            $groups[$key] = $g;
        }

        $columns = self::columns($perCurrency ? 'supplier_currency' : 'supplier');

        return PurchaseGroupReport::sortBy(array_values(array_map(
            static fn (array $g): array => array_merge(array_fill_keys($columns, null), array_intersect_key($g, array_flip($columns))),
            $groups,
        )), 'balance_local');
    }
}
