<?php

declare(strict_types=1);

use App\Modules\Purchasing\Reports\Http\Requests\PurchaseReportRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Tests\Feature\Purchasing\Reports\PurchReportKit as Kit;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri, mixed $user = null, ?string $company = null) => PurchKit::get($user ?? $this->w->user, $company ?? $this->w->company, 'purchase-reports/'.$uri);
    $this->june = 'date_from=2027-06-01&date_to=2027-06-30';
});

it('serves every report and its CSV and XLSX exports to a holder of the permission', function (string $report): void {
    $reader = Actors::user(['purchasing.reports.view'], $this->w->company);
    $json = ($this->get)($report.'?'.$this->june, $reader)->assertOk();
    expect($json->json('meta.pagination.total'))->toBeInt()->toBeGreaterThan(0)
        ->and($json->json('meta.report'))->toBe($report)
        ->and($json->json('meta.currency'))->toBe('TRY');

    $csv = ($this->get)($report.'/export?'.$this->june, $reader)->assertOk();
    expect($csv->headers->get('content-type'))->toContain('text/csv')
        ->and($csv->streamedContent())->toStartWith("\xEF\xBB\xBF");

    $xlsx = ($this->get)($report.'/export?format=xlsx&'.$this->june, $reader)->assertOk();
    expect($xlsx->headers->get('content-disposition'))->toContain('.xlsx');
})->with(fn (): array => PurchaseReportRequest::reports());

it('keeps every report inside the active company', function (): void {
    // The same user in a second company with its own purchases.
    $other = Actors::companyFor($this->w->user, [...PurchKit::ALL, 'purchasing.reports.view']);
    $wh = Inv::warehouse($other, 'FOREIGN', 'block', true);
    $unit = Inv::unit($other, 'BOX');
    $vat = PurchKit::taxCode($other);
    $item = Inv::item($other, ['code' => 'FOREIGN', 'default_tax_code_id' => $vat->id], $unit);
    $party = PurchKit::supplier($other, ['name' => 'Outsider']);
    $foreign = (object) ['company' => $other, 'user' => $this->w->user, 'party' => $party];
    $order = PurchKit::approvedOrder($foreign, [[$item->id, '5', '1000']], ['warehouse_id' => $wh->id]);
    $receipt = PurchKit::receive($foreign, $order['id'], [$order['lines'][0]['id'] => '2']);
    PurchKit::invoiceReceipt($foreign, $receipt['id'], 'OUT-1');
    PurchKit::receive($foreign, $order['id'], [$order['lines'][0]['id'] => '1']);

    $names = fn (string $uri, ?string $company = null): array => array_column(($this->get)($uri, null, $company)->assertOk()->json('data'), 'party_name');
    expect(($this->get)("purchases-by-period?{$this->june}")->json('meta.totals.net_amount'))->toBe('760.0000')
        ->and($names("by-supplier?{$this->june}"))->not->toContain('Outsider')
        ->and($names('open-orders'))->not->toContain('Outsider')
        ->and($names('receipt-vs-invoice'))->not->toContain('Outsider')
        ->and($names('supplier-ageing'))->not->toContain('Outsider')
        ->and($names("price-variance?{$this->june}"))->not->toContain('Outsider')
        ->and($names("supplier-performance?{$this->june}"))->not->toContain('Outsider')
        ->and($names("return-rate?{$this->june}"))->not->toContain('Outsider')
        ->and(($this->get)('receipt-vs-invoice')->json('meta.totals.uninvoiced_value'))->toBe('200.0000')
        // Another company's ids filter to nothing.
        ->and(($this->get)("by-supplier?{$this->june}&party_id={$party->id}")->json('data'))->toBe([])
        ->and(($this->get)("by-item?{$this->june}&item_id={$item->id}")->json('data'))->toBe([]);

    // The other company sees only its own figures.
    expect(($this->get)("purchases-by-period?{$this->june}", null, $other)->json('meta.totals.net_amount'))->toBe('2000.0000')
        ->and(($this->get)('receipt-vs-invoice', null, $other)->json('meta.totals.uninvoiced_value'))->toBe('1000.0000')
        ->and(($this->get)('open-orders', null, $other)->json('meta.totals.open_value_local'))->toBe('2000.0000')
        ->and($names("supplier-performance?{$this->june}", $other))->toBe(['Outsider'])
        ->and(array_column(($this->get)("by-item?{$this->june}", null, $other)->json('data'), 'item_code'))->toBe(['FOREIGN']);
});

it('ignores rows of another company attached to this company documents', function (): void {
    $uris = [
        "purchases-by-period?{$this->june}", "by-item?{$this->june}", 'open-orders', 'receipt-vs-invoice', 'receipt-vs-invoice?as_of=2027-06-12',
        'supplier-ageing?group_by=invoice', "price-variance?{$this->june}", "supplier-performance?{$this->june}", "return-rate?{$this->june}",
        "rfq-savings?{$this->june}&group_by=line",
    ];
    $snapshot = fn (): array => array_map(fn (string $uri): array => ($this->get)($uri)->assertOk()->json(), $uris);
    $before = $snapshot();

    // Rows of company B pointing into company A documents (the single-column foreign keys allow it).
    $b = Actors::companyFor($this->w->user, []);
    $copy = function (string $table, string $id, array $changes) use ($b): void {
        $row = (array) DB::table($table)->where('id', $id)->first();
        DB::table($table)->insert([...$row, 'id' => (string) Str::uuid7(), 'company_id' => $b, ...$changes]);
    };
    DB::statement('ALTER TABLE purchase_invoice_lines DISABLE TRIGGER purchase_invoice_lines_guard');
    DB::statement('ALTER TABLE purchase_receipt_lines DISABLE TRIGGER purchase_receipt_lines_guard');
    $copy('purchase_invoice_lines', $this->h->inv1['lines'][0]['id'], ['line_no' => 99]);
    $copy('purchase_invoice_lines', $this->h->invb['lines'][0]['id'], ['line_no' => 98, 'receipt_line_id' => $this->h->r2['lines'][0]['id'], 'grni_amount' => '50',
        'variance_amount' => '7', 'order_line_id' => $this->h->o1['lines'][0]['id']]);
    $copy('purchase_receipt_lines', $this->h->r2['lines'][0]['id'], ['line_no' => 99]);
    $copy('purchase_order_lines', $this->h->o2['lines'][0]['id'], ['line_no' => 99]);
    $returnLine = (string) DB::table('purchase_return_lines')->where('document_id', $this->h->ret['id'])->value('id');
    $copy('purchase_return_lines', $returnLine, ['line_no' => 99, 'receipt_line_id' => $this->h->r2['lines'][0]['id'], 'cost_total' => '70']);
    $quote = (string) DB::table('purchase_rfq_quotes')->where('rfq_id', $this->h->rfq['id'])->value('id');
    $copy('purchase_rfq_quotes', $quote, ['party_id' => PurchKit::supplier($b)->id, 'unit_price' => '1']);
    DB::table('purchase_payable_applications')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $b, 'invoice_id' => $this->h->invs['id'], 'reference' => 'FOREIGN', 'amount' => '50',
        'applied_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);
    DB::statement('ALTER TABLE purchase_invoice_lines ENABLE TRIGGER purchase_invoice_lines_guard');
    DB::statement('ALTER TABLE purchase_receipt_lines ENABLE TRIGGER purchase_receipt_lines_guard');

    foreach ($snapshot() as $n => $after) {
        expect($after)->toBe($before[$n], $uris[$n]);
    }
});

it('exports exact decimal text with formulas guarded and enforces the row cap', function (): void {
    DB::table('purchase_orders')->where('id', $this->h->o2['id'])->update(['party_name' => '=HYPERLINK("http://x")']);

    $csv = ($this->get)("by-supplier/export?{$this->june}")->assertOk()->streamedContent();
    $lines = array_map('str_getcsv', array_values(array_filter(explode("\n", substr($csv, 3)))));
    expect($lines[0])->toBe(['party_id', 'party_code', 'party_name', 'invoice_count', 'debit_note_count', 'reversal_count', 'purchases_amount',
        'returns_amount', 'net_amount', 'tax_amount', 'total_amount', 'withholding_amount', 'payable_amount', 'share_percent'])
        ->and($lines[1][1])->toBe($this->w->party->code)
        ->and($lines[1][8])->toBe('460.0000')
        ->and($lines[2][8])->toBe('300.0000');

    $orders = ($this->get)('open-orders/export?group_by=order')->assertOk()->streamedContent();
    expect($orders)->toContain('"\'=HYPERLINK(""http://x"")"')->not->toContain(',=HYPERLINK');

    // Negative amounts stay numbers, not guarded text.
    $day = ($this->get)('purchases-by-period/export?period=day&date_from=2027-06-15&date_to=2027-06-15')->streamedContent();
    expect($day)->toContain(',-152.0000,')->not->toContain("'-152");

    $xlsx = ($this->get)('receipt-vs-invoice/export?format=xlsx')->assertOk();
    $path = tempnam(sys_get_temp_dir(), 'prep').'.xlsx';
    file_put_contents($path, file_get_contents($xlsx->baseResponse->getFile()->getPathname()));
    $sheet = IOFactory::load($path)->getActiveSheet();
    $headings = $sheet->rangeToArray('A1:Z1')[0];
    $cell = $sheet->getCell([(int) array_search('uninvoiced_value', $headings, true) + 1, 2]);
    expect($headings[0])->toBe('receipt_id')
        ->and($cell->getValue())->toBe('200.0000')
        ->and($cell->getDataType())->toBe(DataType::TYPE_STRING)
        ->and($sheet->getCell([(int) array_search('item_code', $headings, true) + 1, 2])->getValue())->toBe('WIDGET');
    @unlink($path);

    config(['purchasing.export_max_rows' => 1]);
    ($this->get)("by-supplier/export?{$this->june}")->assertUnprocessable();
    ($this->get)("top-suppliers/export?limit=1&{$this->june}")->assertOk();
    ($this->get)("by-supplier?{$this->june}")->assertOk();
});

it('reads codes and names in bulk so the query count does not grow with the rows', function (): void {
    $uris = [
        "by-supplier?{$this->june}", "by-item?{$this->june}", "top-suppliers?{$this->june}", 'open-orders', 'open-orders?group_by=item',
        'receipt-vs-invoice', 'supplier-ageing', "price-variance?{$this->june}", "supplier-performance?{$this->june}", "return-rate?{$this->june}&group_by=category",
        "by-item/export?{$this->june}", "rfq-savings?{$this->june}&group_by=line",
    ];
    $count = function (string $uri): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        ($this->get)($uri)->assertOk();
        $n = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $n;
    };
    $before = array_map($count, $uris);

    // Twelve more suppliers, items, orders and invoices.
    foreach (range(1, 12) as $n) {
        $party = PurchKit::supplier($this->w->company, ['name' => "Supplier {$n}"]);
        $item = Inv::item($this->w->company, ['code' => "ITEM{$n}", 'default_tax_code_id' => $this->w->vat->id], $this->w->unit);
        $w = (object) [...(array) $this->w, 'party' => $party];
        $order = PurchKit::approvedOrder($w, [[$item->id, '3', (string) (10 + $n)]]);
        $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '2']);
        PurchKit::invoiceReceipt($w, $receipt['id'], "BULK-{$n}");
    }

    foreach ($uris as $i => $uri) {
        expect($count($uri))->toBeLessThanOrEqual($before[$i] + 2, $uri);
    }
});
