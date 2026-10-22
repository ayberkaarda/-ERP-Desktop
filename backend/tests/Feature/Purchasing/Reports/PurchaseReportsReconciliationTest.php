<?php

declare(strict_types=1);

use App\Modules\Purchasing\Contracts\SupplierPerformance;
use Brick\Math\BigDecimal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Purchasing\Reports\PurchReportKit as Kit;
use Tests\Support\Accounting\Books;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri) => Kit::report($this->w, $uri)->assertOk();
    $this->credit = fn (string $code, string $asOf, ?string $from = null): string => Kit::credit($this->w->company, $code, $asOf, $from);
    $this->neg = fn (string $amount): string => (string) BigDecimal::of($amount)->negated()->toScale(4);
});

it('equals the payable and input VAT movements of the ledger for the same period', function (string $from, string $to, string $payable, string $tax): void {
    $totals = ($this->get)("purchases-by-period?period=day&date_from={$from}&date_to={$to}")->json('meta.totals');

    expect($totals['payable_amount'])->toBe($payable)
        ->and(($this->credit)('320', $to, $from))->toBe($payable)
        ->and($totals['tax_amount'])->toBe($tax)
        ->and(($this->neg)(($this->credit)('191', $to, $from)))->toBe($tax)
        ->and(($this->credit)('360', $to, $from))->toBe($totals['withholding_amount']);
})->with([
    'June' => ['2027-06-01', '2027-06-30', '892.0000', '152.0000'],
    'before the reversal and the debit note' => ['2027-06-01', '2027-06-14', '1074.4000', '182.4000'],
    'the reversal day' => ['2027-06-15', '2027-06-15', '-182.4000', '-30.4000'],
    'nothing yet' => ['2027-06-01', '2027-06-10', '0.0000', '0.0000'],
]);

it('nets the GRNI listing to the goods received not invoiced account on every date', function (): void {
    $w = $this->w;
    $check = function (array $dates) use ($w): void {
        foreach ($dates as $asOf) {
            $total = ($this->get)("receipt-vs-invoice?as_of={$asOf}")->json('meta.totals.uninvoiced_value');
            expect($total)->toBe(($this->credit)('381', $asOf), $asOf)
                // The ledger's own balance service agrees.
                ->and(BigDecimal::of(PurchKit::in($w->company, fn () => Books::balance($w->company, '381', $asOf)))->negated()->isEqualTo($total))->toBeTrue($asOf);

            foreach (['receipt', 'supplier', 'item'] as $by) {
                expect(Kit::sum(($this->get)("receipt-vs-invoice?as_of={$asOf}&group_by={$by}")->json('data'), 'uninvoiced_value'))->toBe($total, "{$asOf} {$by}");
            }
        }
    };
    $check(['2027-06-11', '2027-06-12', '2027-06-13', '2027-06-14', '2027-06-15']);

    // A dearer order moves the average cost, so returns leave at another cost than they were received at.
    $o3 = PurchKit::approvedOrder($w, [[$w->item->id, '4', '80']]);
    $kept = PurchKit::receive($w, $o3['id'], [$o3['lines'][0]['id'] => '2'], '2027-06-14');
    $cancelled = PurchKit::receive($w, $o3['id'], [$o3['lines'][0]['id'] => '2'], '2027-06-14');
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$cancelled['id']}/cancel", ['reason' => 'Wrong delivery', 'date' => '2027-06-15'])->assertOk();

    // A receipt return of 1 WIDGET of R2 (not invoiced) and a second invoice return of INV1 shipped, not debited.
    $fromReceipt = PurchKit::post($w->user, $w->company, "purchase-receipts/{$this->h->r2['id']}/returns", [
        'document_date' => '2027-06-15', 'lines' => [['receipt_line_id' => $this->h->r2['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    $fromInvoice = PurchKit::post($w->user, $w->company, "purchase-invoices/{$this->h->inv1['id']}/returns", [
        'document_date' => '2027-06-15', 'lines' => [['invoice_line_id' => $this->h->inv1['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');

    foreach ([$fromReceipt, $fromInvoice] as $return) {
        PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk();
        PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk();
    }

    // Invoiced at another price in another currency view: the accrual is cleared at receipt value.
    PurchKit::invoiceReceipt($w, $kept['id'], 'O3-1');
    $check(['2027-06-13', '2027-06-14', '2027-06-15']);

    // The invoice is dated 13 June, the goods arrived on 14 June: cleared before received.
    expect(Kit::by(($this->get)('receipt-vs-invoice?as_of=2027-06-13')->json('data'), 'receipt_number')[$kept['number']])
        ->toMatchArray(['received_quantity' => '0.000000', 'invoiced_quantity' => '2.000000', 'uninvoiced_quantity' => '-2.000000', 'uninvoiced_value' => '-160.0000']);

    $lines = Kit::by(($this->get)('receipt-vs-invoice?as_of=2027-06-15')->json('data'), 'receipt_number');
    expect($lines[$this->h->r2['number']])->toMatchArray(['received_quantity' => '4.000000', 'returned_quantity' => '1.000000', 'uninvoiced_quantity' => '3.000000',
        'returned_value' => '50.0000', 'uninvoiced_value' => '150.0000'])
        // Shipped back and awaiting its debit note: negative until debited.
        ->and($lines[$this->h->r1['number']])->toMatchArray(['returned_quantity' => '2.000000', 'uninvoiced_quantity' => '-1.000000', 'uninvoiced_value' => '-50.0000'])
        ->and($lines)->not->toHaveKey($cancelled['number'])
        ->and($lines)->not->toHaveKey($kept['number'])
        ->and(Kit::by(($this->get)('receipt-vs-invoice?as_of=2027-06-14')->json('data'), 'receipt_number'))->toHaveKey($cancelled['number']);

    PurchKit::post($w->user, $w->company, "purchase-returns/{$fromInvoice['id']}/debit")->assertOk();
    $check(['2027-06-15']);
    expect(($this->get)('receipt-vs-invoice')->json('meta.totals.uninvoiced_value'))->toBe('150.0000');
});

it('ages payables to the supplier payable balance of the ledger', function (): void {
    foreach (['2027-06-12' => '480.0000', '2027-06-14' => '1074.4000', '2027-06-15' => '892.0000'] as $asOf => $ledger) {
        $ageing = ($this->get)("supplier-ageing?as_of={$asOf}&group_by=invoice");
        $settled = Kit::sum($ageing->json('data'), 'settled_amount');

        expect(($this->credit)('320', $asOf))->toBe($ledger, $asOf)
            // Settlements are not journalled by purchasing (treasury will book them).
            ->and((string) BigDecimal::of($ageing->json('meta.totals.balance_local'))->plus($settled)->toScale(4))->toBe($ledger, $asOf);

        foreach (['supplier', 'supplier_currency'] as $by) {
            expect(Kit::sum(($this->get)("supplier-ageing?as_of={$asOf}&group_by={$by}")->json('data'), 'balance_local'))
                ->toBe($ageing->json('meta.totals.balance_local'), "{$asOf} {$by}");
        }
    }
});

it('equals the price variance account movement, including FX invoices and return cost corrections', function (): void {
    $w = $this->w;
    $june = 'date_from=2027-06-01&date_to=2027-06-30';
    expect(($this->get)("price-variance?{$june}")->json('meta.totals.variance_amount'))->toBe(($this->neg)(($this->credit)('621', '2027-06-30', '2027-06-01')));

    // Received at 30 TRY/USD, invoiced at 32: the rate difference is variance.
    $usd = PurchKit::post($w->user, $w->company, 'purchase-orders', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-14', 'currency_code' => 'USD', 'fx_rate' => '30',
        'lines' => [['item_id' => $w->item->id, 'quantity' => '3', 'unit_price' => '3.333333']],
    ])->assertCreated()->json('data');
    $usd = PurchKit::post($w->user, $w->company, "purchase-orders/{$usd['id']}/submit")->assertOk()->json('data');
    $receipt = PurchKit::receive($w, $usd['id'], [$usd['lines'][0]['id'] => '3'], '2027-06-14');
    PurchKit::invoiceReceipt($w, $receipt['id'], 'USD-9', ['fx_rate' => '32', 'document_date' => '2027-06-15']);

    // The average cost moved, so a return of R2 leaves at another cost than its receipt value.
    $return = PurchKit::post($w->user, $w->company, "purchase-receipts/{$this->h->r2['id']}/returns", [
        'document_date' => '2027-06-15', 'lines' => [['receipt_line_id' => $this->h->r2['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk();

    $rows = ($this->get)("price-variance?{$june}")->json('data');
    $sources = array_count_values(array_column($rows, 'source'));
    expect($sources)->toBe(['invoice' => 2, 'debit_note' => 1, 'return' => 1]);

    foreach ([['2027-06-01', '2027-06-30'], ['2027-06-15', '2027-06-15'], ['2027-06-01', '2027-06-14']] as [$from, $to]) {
        expect(($this->get)("price-variance?date_from={$from}&date_to={$to}")->json('meta.totals.variance_amount'))
            ->toBe(($this->neg)(($this->credit)('621', $to, $from)), "{$from}..{$to}");
    }

    // A reversed invoice takes its variance back on the reversal date.
    $inv = DB::table('purchase_invoices')->where('company_id', $w->company)->where('supplier_invoice_no', 'USD-9')->first();
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$inv->id}/reverse", ['reason' => 'Wrong rate', 'date' => '2027-06-15'])->assertOk();
    expect(($this->get)("price-variance?{$june}")->json('meta.totals.variance_amount'))->toBe(($this->neg)(($this->credit)('621', '2027-06-30', '2027-06-01')))
        ->and(collect(($this->get)("price-variance?{$june}")->json('data'))->where('event', 'reversed')->count())->toBe(1);
});

it('keeps line allocations of FX invoices exact so every grouping adds up to the invoice and the ledger', function (): void {
    $w = $this->w;
    $invoice = PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $this->h->beta->id, 'document_date' => '2027-06-14', 'supplier_invoice_no' => 'EUR-1', 'currency_code' => 'EUR', 'fx_rate' => '32.123456',
        'lines' => [
            ['item_id' => $w->service->id, 'quantity' => '3', 'unit_price' => '33.33', 'withholding_code_id' => $w->withholding->id],
            ['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '10.01', 'tax_code_id' => null],
            ['item_id' => $w->item->id, 'quantity' => '7', 'unit_price' => '0.07'],
        ],
        'receive_on_invoice' => true,
    ])->assertCreated()->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');
    $range = 'date_from=2027-06-14&date_to=2027-06-14';
    $lineNet = Kit::sum($booked['lines'], 'net_local');
    $totals = ($this->get)("purchases-by-period?{$range}")->json('meta.totals');

    // 14 June: INVS (200 / 40 / 20 withheld) and this invoice.
    expect(Kit::sum(($this->get)("by-supplier?{$range}")->json('data'), 'net_amount'))->toBe($totals['net_amount'])
        ->and(Kit::sum(($this->get)("by-item?{$range}")->json('data'), 'net_amount'))->toBe($totals['net_amount'])
        ->and(Kit::sum(($this->get)("by-item?{$range}")->json('data'), 'tax_amount'))->toBe($totals['tax_amount'])
        ->and(Kit::sum(($this->get)("by-item?{$range}")->json('data'), 'withholding_amount'))->toBe($totals['withholding_amount'])
        ->and($totals['net_amount'])->toBe((string) BigDecimal::of('200')->plus($lineNet)->toScale(4))
        ->and($totals['total_amount'])->toBe((string) BigDecimal::of('240')->plus($booked['total_local'])->toScale(4))
        ->and($totals['withholding_amount'])->toBe((string) BigDecimal::of('20')->plus($booked['withholding_total_local'])->toScale(4))
        ->and($totals['payable_amount'])->toBe(($this->credit)('320', '2027-06-14', '2027-06-14'))
        ->and($totals['tax_amount'])->toBe(($this->neg)(($this->credit)('191', '2027-06-14', '2027-06-14')))
        ->and($totals['withholding_amount'])->toBe(($this->credit)('360', '2027-06-14', '2027-06-14'));
});

it('agrees with the SupplierPerformance contract for every supplier', function (): void {
    $w = $this->w;
    $rows = Kit::by(($this->get)('supplier-performance?date_from=2027-06-01&date_to=2027-06-30')->json('data'), 'party_id');
    expect($rows)->toHaveCount(2);

    foreach ([$w->party->id, $this->h->beta->id] as $party) {
        $contract = PurchKit::in($w->company, fn () => app(SupplierPerformance::class)->forParty($w->company, $party, new DateTimeImmutable('2027-06-01'), new DateTimeImmutable('2027-06-30')));

        expect($rows[$party])->toMatchArray([
            'orders' => $contract->orders, 'on_time_rate' => $contract->onTimeRate, 'fill_rate' => $contract->fillRate, 'avg_lead_days' => $contract->avgLeadDays,
            'price_variance_total' => $contract->priceVarianceTotal, 'return_rate' => $contract->returnRate, 'overdue_payable' => $contract->overduePayable,
        ]);
    }

    expect($rows[$w->party->id])->toMatchArray(['party_name' => 'Supplier A', 'orders' => 1, 'receipt_lines' => 2, 'on_time_lines' => 1, 'on_time_rate' => '0.5000',
        'fill_rate' => '1.0000', 'avg_lead_days' => '2.00', 'price_variance_total' => '10.00', 'return_rate' => '0.1000', 'overdue_payable' => '494.40'])
        ->and(($this->get)("supplier-performance?party_id={$this->h->beta->id}")->json('data'))->toHaveCount(1);
});
