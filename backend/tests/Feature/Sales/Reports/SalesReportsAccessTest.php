<?php

declare(strict_types=1);

use App\Modules\Sales\Reports\Http\Requests\SalesReportRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sales\SalesReportKit as Kit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri, mixed $user = null, ?string $company = null) => SalesKit::get($user ?? $this->w->user, $company ?? $this->w->company, 'sales-reports/'.$uri);
});

it('answers 403 before validation without the report permission on every route', function (string $report, bool $export): void {
    $user = SalesKit::user();
    $uri = $report.($export ? '/export' : '').'?as_of=nope&date_from=x&group_by=nope&format=pdf&per_page=0';

    ($this->get)($uri, $user)->assertForbidden();
})->with(fn (): array => array_merge(...array_map(
    fn (string $r): array => [$r => [$r, false], $r.' export' => [$r, true]],
    SalesReportRequest::reports(),
)));

it('serves every report and its CSV and XLSX exports to a holder of the permission', function (string $report): void {
    $json = ($this->get)($report.'?date_from=2027-06-01&date_to=2027-06-30')->assertOk();
    expect($json->json('meta.pagination.total'))->toBeInt()
        ->and($json->json('meta.report'))->toBe($report)
        ->and($json->json('meta.currency'))->toBe('TRY');

    $csv = ($this->get)($report.'/export?date_from=2027-06-01&date_to=2027-06-30')->assertOk();
    expect($csv->headers->get('content-type'))->toContain('text/csv')
        ->and($csv->streamedContent())->toStartWith("\xEF\xBB\xBF");

    $xlsx = ($this->get)($report.'/export?format=xlsx&date_from=2027-06-01&date_to=2027-06-30')->assertOk();
    expect($xlsx->headers->get('content-disposition'))->toContain('.xlsx');
})->with(fn (): array => SalesReportRequest::reports());

it('grants the report permission to the sales, accountant and viewer roles by default', function (): void {
    $catalog = require app_path('Modules/Sales/permissions.php');

    expect($catalog['permissions']['sales.reports.view']['roles'])->toEqualCanonicalizing(['Sales', 'Accountant', 'Viewer']);

    foreach (['Sales', 'Accountant', 'Viewer'] as $role) {
        expect(DB::table('roles as r')->join('role_has_permissions as rp', 'rp.role_id', '=', 'r.id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('r.name', $role)->where('p.name', 'sales.reports.view')->exists())->toBeTrue($role);
    }

    expect(DB::table('roles as r')->join('role_has_permissions as rp', 'rp.role_id', '=', 'r.id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
        ->where('r.name', 'Warehouse')->where('p.name', 'sales.reports.view')->exists())->toBeFalse();
});

it('rejects invalid parameters with 422', function (string $uri): void {
    ($this->get)($uri)->assertUnprocessable();
})->with([
    'bad date' => ['sales-by-period?date_from=2027-13-01'],
    'reversed range' => ['by-customer?date_from=2027-06-10&date_to=2027-06-01'],
    'bad period' => ['sales-by-period?period=year'],
    'group on a report without groups' => ['by-item?group_by=customer'],
    'bad margin group' => ['margin?group_by=lot'],
    'bad ageing group' => ['customer-ageing?group_by=item'],
    'bad as_of' => ['customer-ageing?as_of=15.06.2027'],
    'bad party' => ['by-customer?party_id=nope'],
    'bad currency' => ['by-customer?currency_code=usd'],
    'limit too big' => ['top-customers?limit=101'],
    'bad format' => ['margin/export?format=pdf'],
    'per page too big' => ['open-orders?per_page=501'],
]);

it('keeps every report inside the active company', function (): void {
    // The same user in a second company with its own sales.
    $other = Actors::companyFor($this->w->user, [...SalesKit::ALL, 'sales.reports.view']);
    $wh = SalesKit::warehouse($other, 'FOREIGN');
    $unit = SalesKit::unit($other, 'BOX');
    $vat = SalesKit::taxCode($other);
    $item = SalesKit::item($other, ['code' => 'FOREIGN', 'default_tax_code_id' => $vat->id], $unit);
    SalesKit::receive($other, $wh->id, $item->id, '5', '7');
    $party = SalesKit::party($other, ['name' => 'Outsider']);
    $foreign = (object) ['company' => $other, 'user' => $this->w->user, 'party' => $party];
    $order = SalesKit::confirmedOrder($foreign, [[$item->id, '2', '1000']], ['warehouse_id' => $wh->id]);
    $delivery = SalesKit::deliver($foreign, $order['id'], [$order['lines'][0]['id'] => '1']);
    SalesKit::invoiceDelivery($foreign, $delivery['id']);

    $range = 'date_from=2027-06-01&date_to=2027-06-30';
    expect(($this->get)("sales-by-period?{$range}")->json('meta.totals.net_amount'))->toBe('810.0000')
        ->and(array_column(($this->get)("by-customer?{$range}")->json('data'), 'party_name'))->not->toContain('Outsider')
        ->and(array_column(($this->get)('open-orders')->json('data'), 'party_name'))->not->toContain('Outsider')
        ->and(array_column(($this->get)('delivery-vs-invoice?as_of=2027-06-12')->json('data'), 'party_name'))->not->toContain('Outsider')
        ->and(array_column(($this->get)('customer-ageing')->json('data'), 'party_name'))->not->toContain('Outsider')
        ->and(($this->get)("margin?{$range}")->json('meta.totals.cogs'))->toBe('200.0000')
        // Another company's ids filter to nothing.
        ->and(($this->get)("by-customer?{$range}&party_id={$party->id}")->json('data'))->toBe([])
        ->and(($this->get)("by-item?{$range}&item_id={$item->id}")->json('data'))->toBe([]);

    // The other company sees only its own figures.
    expect(($this->get)("sales-by-period?{$range}", null, $other)->json('meta.totals.net_amount'))->toBe('1000.0000')
        ->and(($this->get)("margin?{$range}", null, $other)->json('meta.totals.cogs'))->toBe('7.0000')
        ->and(array_column(($this->get)("by-item?{$range}", null, $other)->json('data'), 'item_code'))->toBe(['FOREIGN']);
});

it('exports exact decimal text with formulas guarded and enforces the row cap', function (): void {
    DB::table('sales_orders')->where('id', $this->h->o2['id'])->update(['party_name' => '=HYPERLINK("http://x")']);

    $csv = ($this->get)('by-customer/export?date_from=2027-06-01&date_to=2027-06-30')->assertOk()->streamedContent();
    $lines = array_map('str_getcsv', array_values(array_filter(explode("\n", substr($csv, 3)))));
    expect($lines[0])->toBe(['party_id', 'party_code', 'party_name', 'invoice_count', 'credit_note_count', 'reversal_count',
        'sales_amount', 'returns_amount', 'net_amount', 'tax_amount', 'total_amount', 'share_percent'])
        ->and($lines[1][1])->toBe($this->h->beta->code)
        ->and($lines[1][8])->toBe('610.0000')
        ->and($lines[2][8])->toBe('200.0000')
        ->and($lines[2][7])->toBe('100.0000');

    $orders = ($this->get)('open-orders/export?group_by=order')->assertOk()->streamedContent();
    expect($orders)->toContain('"\'=HYPERLINK(""http://x"")"')->not->toContain(',=HYPERLINK');

    // Negative amounts stay numbers, not guarded text.
    $day = ($this->get)('sales-by-period/export?period=day&date_from=2027-06-15&date_to=2027-06-15')->streamedContent();
    expect($day)->toContain(',-150.0000,')->not->toContain("'-150");

    $xlsx = ($this->get)('margin/export?format=xlsx&date_from=2027-06-01&date_to=2027-06-30')->assertOk();
    $path = tempnam(sys_get_temp_dir(), 'srep').'.xlsx';
    file_put_contents($path, file_get_contents($xlsx->baseResponse->getFile()->getPathname()));
    $sheet = IOFactory::load($path)->getActiveSheet();
    $headings = $sheet->rangeToArray('A1:J1')[0];
    $cell = $sheet->getCell([(int) array_search('revenue', $headings, true) + 1, 2]);
    expect($headings[0])->toBe('item_id')
        ->and($cell->getValue())->toBe('610.0000')
        ->and($cell->getDataType())->toBe(DataType::TYPE_STRING)
        ->and($sheet->getCell([(int) array_search('item_code', $headings, true) + 1, 2])->getValue())->toBe('SETUP');
    @unlink($path);

    config(['sales.export_max_rows' => 1]);
    ($this->get)('by-customer/export?date_from=2027-06-01&date_to=2027-06-30')->assertUnprocessable();
    ($this->get)('top-customers/export?limit=1&date_from=2027-06-01&date_to=2027-06-30')->assertOk();
    ($this->get)('by-customer?date_from=2027-06-01&date_to=2027-06-30')->assertOk();
});

it('ignores rows of another company attached to this company documents', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/send")->assertOk();

    $uris = [
        'sales-by-period?date_from=2027-06-01&date_to=2027-06-30', 'by-item?date_from=2027-06-01&date_to=2027-06-30',
        'margin?date_from=2027-06-01&date_to=2027-06-30', 'return-rate?date_from=2027-06-01&date_to=2027-06-30',
        'open-orders', 'delivery-vs-invoice', 'customer-ageing?group_by=invoice',
        'quote-conversion?date_from=2027-06-01&date_to=2027-06-30', "quote-conversion?date_from=2027-06-01&date_to=2027-06-30&item_id={$this->w->item->id}",
    ];
    $snapshot = fn (): array => array_map(fn (string $uri): array => ($this->get)($uri)->assertOk()->json(), $uris);
    $before = $snapshot();

    // Rows of company B pointing into company A documents (the single-column foreign keys allow it).
    $b = Actors::companyFor($this->w->user, []);
    $copy = function (string $table, string $id, array $changes) use ($b): void {
        $row = (array) DB::table($table)->where('id', $id)->first();
        DB::table($table)->insert([...$row, 'id' => (string) Str::uuid7(), 'company_id' => $b, ...$changes]);
    };
    DB::statement('ALTER TABLE sales_invoice_lines DISABLE TRIGGER sales_invoice_lines_guard');
    DB::statement('ALTER TABLE sales_delivery_lines DISABLE TRIGGER sales_delivery_lines_guard');
    $copy('sales_invoice_lines', $this->h->inv1['lines'][0]['id'], ['line_no' => 99]);
    $copy('sales_invoice_lines', $this->h->inv2['lines'][0]['id'], ['line_no' => 98, 'delivery_line_id' => $this->h->d2['lines'][0]['id'], 'item_id' => $this->w->item->id, 'quantity' => '2']);
    $copy('sales_delivery_lines', $this->h->d2['lines'][0]['id'], ['line_no' => 99]);
    $copy('sales_order_lines', $this->h->o2['lines'][0]['id'], ['line_no' => 99]);
    $returnLine = DB::table('sales_return_lines')->where('document_id', $this->h->crn['return_id'])->value('id');
    $copy('sales_return_lines', (string) $returnLine, ['line_no' => 99]);
    $copy('sales_quote_lines', $quote['lines'][0]['id'], ['line_no' => 99, 'item_id' => $this->w->item->id]);
    $copy('sales_quotes', $quote['id'], ['number' => null, 'previous_revision_id' => $quote['id'], 'status' => 'sent']);
    DB::table('sales_receivable_applications')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $b, 'invoice_id' => $this->h->inv1['id'], 'reference' => 'FOREIGN', 'amount' => '50',
        'applied_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);
    DB::statement('ALTER TABLE sales_invoice_lines ENABLE TRIGGER sales_invoice_lines_guard');
    DB::statement('ALTER TABLE sales_delivery_lines ENABLE TRIGGER sales_delivery_lines_guard');

    foreach ($snapshot() as $n => $after) {
        expect($after)->toBe($before[$n], $uris[$n]);
    }
});
