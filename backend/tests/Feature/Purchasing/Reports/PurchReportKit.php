<?php

declare(strict_types=1);

namespace Tests\Feature\Purchasing\Reports;

use App\Modules\Purchasing\Contracts\PayableSettlement;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Purchasing\PurchKit;

/**
 * A hand-computed purchasing history of June 2027 (clock 2027-06-15, company currency TRY, VAT 20%):
 * - O1 Supplier A (2027-06-10, expected 2027-06-12): WIDGET 10 x 50, SETUP 1 x 200 with 5/10 withholding;
 * - R1 2027-06-12: 6 WIDGET received (cost 300, Cr 381 300);
 * - INV1 2027-06-13 (A, price override 52): 6 x 52 = 312 / VAT 62.40 / 374.40, clears 300 of the
 *   accrual, variance 12 (621), due 2027-06-13; settled 100 today (PAY-1);
 * - INV3 2027-06-12 (A, direct SETUP 100 / 20 / 120), reversed 2027-06-15;
 * - INVS 2027-06-14 (A, from O1: SETUP 200 / VAT 40 / withheld 20, payable 220);
 * - R2 2027-06-14: 4 WIDGET received (cost 200), not invoiced;
 * - RET1 2027-06-15: 1 WIDGET of INV1 returned, shipped (receipt value 50, stock cost 50) and debited:
 *   DN 52 / 10.40 / 62.40, accrual 50 back, variance 2 credited;
 * - INVB 2027-06-11 (Beta, USD 10 SETUP at 30: 300 / 60 / 360 local), due 2027-07-20;
 * - O2 Beta (2027-06-10, expected 2027-06-12): WIDGET 4 x 80 approved, nothing received;
 * - RFQ1 2027-06-10: WIDGET 10, A quotes 50, Beta 60 less 10% (54): awarded to A.
 * June: purchases 812, returns 52, net 760, VAT 152, total 912, withheld 20, payable 892 (= 320 credit).
 */
final class PurchReportKit
{
    /**
     * @param  list<string>  $extra  permissions of the report user besides purchasing.reports.view
     */
    public static function history(array $extra = []): object
    {
        $w = PurchKit::world();
        $w->user = PurchKit::user(['purchasing.reports.view', 'purchasing.price_override', ...$extra]);
        $u = $w->user;
        $c = $w->company;
        $beta = PurchKit::supplier($c, ['name' => 'Supplier Beta']);

        $o1 = PurchKit::post($u, $c, 'purchase-orders', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'expected_date' => '2027-06-12',
            'lines' => [
                ['item_id' => $w->item->id, 'quantity' => '10', 'unit_price' => '50'],
                ['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '200', 'withholding_code_id' => $w->withholding->id],
            ],
        ])->assertCreated()->json('data');
        $o1 = PurchKit::post($u, $c, "purchase-orders/{$o1['id']}/submit")->assertOk()->json('data');
        $r1 = PurchKit::receive($w, $o1['id'], [$o1['lines'][0]['id'] => '6'], '2027-06-12');

        $inv1 = PurchKit::post($u, $c, "purchase-receipts/{$r1['id']}/invoice", [
            'document_date' => '2027-06-13', 'supplier_invoice_no' => 'A-1', 'due_date' => '2027-06-13',
            'lines' => [['receipt_line_id' => $r1['lines'][0]['id'], 'quantity' => '6', 'unit_price' => '52']],
        ])->assertCreated()->json('data');
        $inv1 = PurchKit::post($u, $c, "purchase-invoices/{$inv1['id']}/book")->assertOk()->json('data');

        $inv3 = PurchKit::post($u, $c, 'purchase-invoices', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-12', 'supplier_invoice_no' => 'A-3',
            'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100']],
        ])->assertCreated()->json('data');
        PurchKit::post($u, $c, "purchase-invoices/{$inv3['id']}/book")->assertSuccessful();
        $inv3 = PurchKit::post($u, $c, "purchase-invoices/{$inv3['id']}/reverse", ['reason' => 'Duplicate', 'date' => '2027-06-15'])->assertOk()->json('data');

        $invs = PurchKit::post($u, $c, "purchase-orders/{$o1['id']}/invoices", [
            'document_date' => '2027-06-14', 'supplier_invoice_no' => 'A-S', 'due_date' => '2027-06-14',
            'lines' => [['order_line_id' => $o1['lines'][1]['id'], 'quantity' => '1']],
        ])->assertCreated()->json('data');
        $invs = PurchKit::post($u, $c, "purchase-invoices/{$invs['id']}/book")->assertOk()->json('data');

        $r2 = PurchKit::receive($w, $o1['id'], [$o1['lines'][0]['id'] => '4'], '2027-06-14');

        $ret = PurchKit::post($u, $c, "purchase-invoices/{$inv1['id']}/returns", [
            'document_date' => '2027-06-15', 'reason' => 'Damaged', 'lines' => [['invoice_line_id' => $inv1['lines'][0]['id'], 'quantity' => '1']],
        ])->assertCreated()->json('data');
        PurchKit::post($u, $c, "purchase-returns/{$ret['id']}/approve")->assertSuccessful();
        PurchKit::post($u, $c, "purchase-returns/{$ret['id']}/ship")->assertSuccessful();
        $ret = PurchKit::post($u, $c, "purchase-returns/{$ret['id']}/debit")->assertOk()->json('data');

        $invb = PurchKit::post($u, $c, 'purchase-invoices', [
            'party_id' => $beta->id, 'document_date' => '2027-06-11', 'supplier_invoice_no' => 'B-1', 'currency_code' => 'USD', 'fx_rate' => '30',
            'due_date' => '2027-07-20', 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '10']],
        ])->assertCreated()->json('data');
        $invb = PurchKit::post($u, $c, "purchase-invoices/{$invb['id']}/book")->assertOk()->json('data');

        $wBeta = (object) [...(array) $w, 'party' => $beta];
        $o2 = PurchKit::approvedOrder($wBeta, [[$w->item->id, '4', '80']], ['expected_date' => '2027-06-12']);

        $rfq = PurchKit::post($u, $c, 'purchase-rfqs', [
            'document_date' => '2027-06-10', 'supplier_ids' => [$w->party->id, $beta->id], 'lines' => [['item_id' => $w->item->id, 'quantity' => '10']],
        ])->assertCreated()->json('data');
        PurchKit::post($u, $c, "purchase-rfqs/{$rfq['id']}/send")->assertSuccessful();
        $line = $rfq['lines'][0]['id'];
        PurchKit::post($u, $c, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [['rfq_line_id' => $line, 'unit_price' => '50', 'lead_time_days' => 3]]])->assertSuccessful();
        PurchKit::post($u, $c, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $beta->id, 'quotes' => [['rfq_line_id' => $line, 'unit_price' => '60', 'discount_percent' => '10']]])->assertSuccessful();
        $rfq = PurchKit::post($u, $c, "purchase-rfqs/{$rfq['id']}/award", ['party_id' => $w->party->id, 'document_date' => '2027-06-15'])->assertSuccessful()->json('data');

        PurchKit::in($c, fn () => app(PayableSettlement::class)->apply($c, $inv1['id'], '100', 'PAY-1'));

        return (object) compact('w', 'beta', 'o1', 'o2', 'r1', 'r2', 'inv1', 'inv3', 'invs', 'invb', 'ret', 'rfq');
    }

    /**
     * @return TestResponse<Response>
     */
    public static function report(object $w, string $uri): TestResponse
    {
        return PurchKit::get($w->user, $w->company, 'purchase-reports/'.$uri);
    }

    /**
     * Rows keyed by a column.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, array<string, mixed>>
     */
    public static function by(array $rows, string $column): array
    {
        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row[$column]] = $row;
        }

        return $out;
    }

    /**
     * Credit-positive balance of an account code from booked entries dated on or before $asOf
     * (or the movement within [$from, $asOf] when $from is given), scale 4.
     */
    public static function credit(string $company, string $code, string $asOf, ?string $from = null): string
    {
        $row = DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('e.company_id', $company)->whereIn('e.status', ['posted', 'reversed'])->where('a.code', $code)->where('e.entry_date', '<=', $asOf)
            ->when($from !== null, fn ($q) => $q->where('e.entry_date', '>=', $from))
            ->selectRaw('coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) AS balance')->first();

        return (string) BigDecimal::of((string) ($row->balance ?? '0'))->toScale(4);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    public static function sum(array $rows, string $column): string
    {
        return (string) array_reduce($rows, static fn (BigDecimal $c, array $r): BigDecimal => $c->plus((string) ($r[$column] ?? '0')), BigDecimal::zero())->toScale(4);
    }
}
