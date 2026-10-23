<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\Sql;
use App\Modules\Purchasing\Reports\Support\Window;
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
 * largest balance first. Computed in SQL: only the requested page of rows (or groups) is read.
 */
final class SupplierAgeingReport
{
    public const array GROUPS = ['supplier', 'supplier_currency', 'invoice'];

    public const array BUCKETS = ['not_due', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90'];

    private const array MONEY = ['payable', 'settled_amount', 'balance', 'balance_local', ...self::BUCKETS, 'overdue'];

    private const array INTEGERS = ['days_overdue', 'invoice_count'];

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

    public function build(ReportFilters $f, string $by, Window $window): ReportTable
    {
        $asOf = (string) $f->asOf;
        $lines = DB::query()->fromSub($this->invoices($f, $asOf), 't')->where('t.balance', '<>', 0);
        $totals = (clone $lines)->selectRaw('count(*) AS invoice_count, '.self::buckets('balance_local'))->first();
        $columns = self::columns($by);

        if ($by === 'invoice') {
            $ordered = $lines->select('t.*')->orderByDesc('t.balance_local')->orderBy('t.invoice_id');
            $total = (int) ($totals->invoice_count ?? 0);
        } else {
            $currency = $by === 'supplier_currency';
            $groups = $lines->groupBy(...($currency ? ['t.party_id', 't.currency_code'] : ['t.party_id']))
                ->selectRaw(($currency ? "t.party_id || '|' || t.currency_code AS group_key, t.currency_code, coalesce(sum(t.balance), 0) AS balance, " : 't.party_id AS group_key, ')
                    .'t.party_id, (array_agg(t.party_name ORDER BY t.document_date DESC, t.invoice_id DESC))[1] AS party_name, count(*) AS invoice_count,
                    coalesce(sum(t.balance_local), 0) AS balance_local, min(t.due_date) AS oldest_due_date, '.self::buckets($currency ? 'balance' : 'balance_local', false));
            $total = Sql::count($groups);
            $ordered = DB::query()->fromSub($groups, 'g')->orderByDesc('g.balance_local')->orderBy('g.group_key');
        }

        return new ReportTable(Sql::window($ordered, $window, $total, $columns, self::MONEY, ['fx_rate'], self::INTEGERS), $columns, [
            'as_of' => $asOf,
            'group_by' => $by,
            'totals' => [
                'invoice_count' => (int) ($totals->invoice_count ?? 0),
                ...array_combine(['balance_local', ...self::BUCKETS, 'overdue'], array_map(
                    static fn (string $c): string => Num::money(Num::dec($totals->{$c} ?? '0')), ['balance_local', ...self::BUCKETS, 'overdue'],
                )),
            ],
        ], $total);
    }

    /**
     * Bucket sums of an amount column (and the overall local balance when $withTotal).
     *
     * @param  literal-string  $amount
     * @return literal-string
     */
    private static function buckets(string $amount, bool $withTotal = true): string
    {
        $sql = $withTotal ? 'coalesce(sum(t.balance_local), 0) AS balance_local, ' : '';

        foreach (self::BUCKETS as $bucket) {
            $sql .= "coalesce(sum(t.{$amount}) FILTER (WHERE t.bucket = '{$bucket}'), 0) AS {$bucket}, ";
        }

        return $sql."coalesce(sum(t.{$amount}) FILTER (WHERE t.bucket <> 'not_due'), 0) AS overdue";
    }

    /** One row per booked invoice or debit note open as of the date, signed (debit notes negative). */
    private function invoices(ReportFilters $f, string $asOf): Builder
    {
        $tz = (string) config('app.timezone', 'UTC');
        $endOfDay = Carbon::parse($asOf, $tz)->addDay()->startOfDay();
        $settled = DB::table('purchase_payable_applications as a')
            ->whereColumn('a.invoice_id', 'i.id')
            ->where('a.company_id', $f->companyId)
            ->whereRaw('coalesce(a.effective_date,a.applied_at::date) < ?::date', [$endOfDay])
            ->where(fn (Builder $q) => $q->whereNull('a.unapplied_at')->orWhereRaw('coalesce(a.unapplied_effective_date,a.unapplied_at::date) >= ?::date', [$endOfDay]))
            ->selectRaw('coalesce(sum(a.amount), 0)');
        $settledLocal = (clone $settled)->select([])->selectRaw('coalesce(sum(coalesce(a.local_amount,round(a.amount * (i.total_local - i.withholding_total_local) / nullif((i.total - i.withholding_total),0),2))),0)');
        $base = DB::table('purchase_invoices as i')
            ->where('i.company_id', $f->companyId)
            ->whereIn('i.status', [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])
            ->where('i.document_date', '<=', $asOf)
            ->where(fn (Builder $q) => $q->where('i.status', '<>', InvoiceStatus::Reversed->value)->orWhere('i.reversal_date', '>', $asOf))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('i.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('i.currency_code', $f->currencyCode))
            ->select(['i.id', 'i.number', 'i.supplier_invoice_no', 'i.invoice_type', 'i.document_date', 'i.party_id', 'i.party_name', 'i.currency_code',
                'i.fx_rate', 'i.total', 'i.withholding_total', 'i.total_local', 'i.withholding_total_local'])
            ->selectRaw('coalesce(i.due_date, i.document_date) AS due_date')
            ->selectRaw('CASE WHEN i.invoice_type = ? THEN -1 ELSE 1 END AS sign', [InvoiceType::Return->value])
            ->selectSub($settled, 'settled')->selectSub($settledLocal, 'settled_local');
        $days = '(?::date - b.due_date)';

        return DB::query()->fromSub($base, 'b')
            ->select(['b.id as invoice_id', 'b.number', 'b.supplier_invoice_no', 'b.invoice_type', 'b.document_date', 'b.due_date', 'b.party_id',
                'b.party_name', 'b.currency_code', 'b.fx_rate'])
            ->selectRaw("{$days} AS days_overdue", [$asOf])
            ->selectRaw("CASE WHEN {$days} < 0 THEN 'not_due' WHEN {$days} <= 30 THEN 'days_0_30' WHEN {$days} <= 60 THEN 'days_31_60'
                WHEN {$days} <= 90 THEN 'days_61_90' ELSE 'days_over_90' END AS bucket", [$asOf, $asOf, $asOf, $asOf])
            ->selectRaw('(b.total - b.withholding_total) * b.sign AS payable, b.settled * b.sign AS settled_amount')
            ->selectRaw('(b.total - b.withholding_total - b.settled) * b.sign AS balance')
            ->selectRaw('(b.total_local - b.withholding_total_local - b.settled_local) * b.sign AS balance_local');
    }
}
