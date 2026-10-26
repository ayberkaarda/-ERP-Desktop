<?php

declare(strict_types=1);

use App\Modules\Sales\Support\SalesSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->other = SalesKit::party($this->w->company, ['name' => '=HYPERLINK("x")']);
    $make = fn (string $party, string $date, string $price, string $item): array => SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $party, 'document_date' => $date, 'notes' => 'Order of '.$date,
        'lines' => [['item_id' => $item, 'quantity' => '1', 'unit_price' => $price]],
    ])->assertCreated()->json('data');
    $this->a = $make($this->w->party->id, '2027-06-01', '100', $this->w->item->id);
    $this->b = $make($this->other->id, '2027-06-05', '300', $this->w->service->id);
    $this->c = $make($this->w->party->id, '2027-06-09', '200', $this->w->service->id);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->c['id']}/confirm")->assertOk();
});

it('lists with filters, search, sorting and pagination', function (): void {
    $api = fn (string $query) => SalesKit::get($this->w->user, $this->w->company, 'sales-orders?'.$query)->assertOk();

    $api('')->assertJsonPath('meta.pagination.total', 3)->assertJsonPath('data.0.id', $this->c['id'])->assertJsonPath('data.0.line_count', 1);
    $api('filter[status]=confirmed')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.number', 'ORD2027000000001');
    $api('filter[status]=draft,confirmed')->assertJsonPath('meta.pagination.total', 3);
    $api("filter[party_id]={$this->w->party->id}")->assertJsonPath('meta.pagination.total', 2);
    $api('filter[date_from]=2027-06-02&filter[date_to]=2027-06-09')->assertJsonPath('meta.pagination.total', 2);
    $api("filter[item_id]={$this->w->item->id}")->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.id', $this->a['id']);
    $api('filter[number]=0001')->assertJsonPath('meta.pagination.total', 1);
    $api('q=HYPERLINK')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.id', $this->b['id']);
    $api('q=2027-06-05')->assertJsonPath('meta.pagination.total', 1);
    $api('sort=total')->assertJsonPath('data.0.id', $this->a['id'])->assertJsonPath('data.2.id', $this->b['id']);
    $api('sort=-document_date&per_page=1&page=2')->assertJsonPath('data.0.id', $this->b['id'])->assertJsonPath('meta.pagination.last_page', 3);

    SalesKit::get($this->w->user, $this->w->company, 'sales-orders?filter[bogus]=1')->assertStatus(422);
    SalesKit::get($this->w->user, $this->w->company, 'sales-orders?filter[date_from]=junk')->assertStatus(422);
    SalesKit::get($this->w->user, $this->w->company, 'sales-orders?sort=secret')->assertStatus(422);
});

it('shows a document with lines, links, warnings and audit', function (): void {
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100']);
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$this->a['id']}")->assertOk()
        ->assertJsonPath('data.lines.0.item_id', $this->w->item->id)
        ->assertJsonPath('data.links.deliveries', [])
        ->assertJsonPath('data.warnings.0.code', 'sales.credit_limit_exceeded')
        ->assertJsonPath('data.audit.0.event', 'created');
});

it('exports CSV and XLSX with formula guard and refuses above the cap', function (): void {
    $csv = SalesKit::as($this->w->user, $this->w->company)->get('/api/v1/sales-orders/export?filter[party_id]='.$this->other->id);
    $csv->assertOk();
    $body = $csv->streamedContent();
    expect($body)->toContain('number,status,document_date')->toContain("'=HYPERLINK")->toContain('360.0000')
        ->and(substr_count(trim($body), "\n"))->toBe(1);

    $xlsx = SalesKit::as($this->w->user, $this->w->company)->get('/api/v1/sales-orders/export?format=xlsx')->assertOk();
    expect((string) $xlsx->headers->get('content-disposition'))->toContain('.xlsx');

    config(['sales.export_max_rows' => 2]);
    SalesKit::get($this->w->user, $this->w->company, 'sales-orders/export')->assertStatus(422);
    SalesKit::as($this->w->user, $this->w->company)->get('/api/v1/sales-invoices/export?filter[invoice_type]=sale')->assertOk();
});

it('returns a print model with item and unit codes, taxes and totals', function (): void {
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$this->a['id']}/print-model")->assertOk()
        ->assertJsonPath('data.document_type', 'sales_order')
        ->assertJsonPath('data.party.name', 'Acme')
        ->assertJsonPath('data.lines.0.item_code', 'WIDGET')
        ->assertJsonPath('data.lines.0.unit_code', $this->w->unit->code)
        ->assertJsonPath('data.taxes.0.rate', '20.0000')
        ->assertJsonPath('data.taxes.0.tax', '20.00')
        ->assertJsonPath('data.totals.total', '120.0000')
        ->assertJsonPath('data.company.id', $this->w->company);
});

it('registers the settings with labels in every locale', function (): void {
    foreach (['tr', 'en', 'de', 'fr'] as $locale) {
        foreach (SalesSettings::KEYS as $key) {
            expect(trans()->hasForLocale('settings::registry.'.$key, $locale))->toBeTrue("{$locale}: {$key}");
        }
    }

    // The other modules' labels are untouched.
    expect(__('settings::registry.company.base_currency', [], 'tr'))->toBe('Ana para birimi');

    $admin = Actors::user(['settings.view', 'settings.update']);
    SalesKit::as($admin, $this->w->company)->getJson('/api/v1/settings?group=sales')->assertOk()
        ->assertJsonFragment(['key' => 'sales.credit_check_mode', 'value' => 'warn', 'is_default' => true])
        ->assertJsonFragment(['key' => 'sales.rounding', 'value' => 'per_line']);
    SalesKit::as($admin, $this->w->company)->patchJson('/api/v1/settings', ['settings' => ['sales.require_approval_over' => 'abc']])->assertStatus(422);
    SalesKit::as($admin, $this->w->company)->patchJson('/api/v1/settings', ['settings' => ['sales.require_approval_over' => '2500.50', 'sales.rounding' => 'per_total']])->assertOk();
    expect(SalesKit::in($this->w->company, fn () => app(SalesSettings::class)->approvalThreshold()))->toBe('2500.50');
});

it('rounds documents per total when the company says so', function (): void {
    SalesKit::setting($this->w->company, 'sales.rounding', 'per_total');
    $lines = array_fill(0, 3, ['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '0.10', 'tax_code_id' => SalesKit::taxCode($this->w->company, '18.0000')->id]);
    $lines[1]['tax_code_id'] = $lines[0]['tax_code_id'];
    $lines[2]['tax_code_id'] = $lines[0]['tax_code_id'];
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id, 'lines' => $lines])->assertCreated()
        ->assertJsonPath('data.tax_total', '0.0500');
});

it('deletes drafts only, with an optional version check', function (): void {
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-orders/{$this->a['id']}?version=9")->assertStatus(409);
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-orders/{$this->a['id']}")->assertNoContent();
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-orders/{$this->c['id']}")->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    expect(DB::table('sales_orders')->count())->toBe(2);
});

it('requires an idempotency key on creating posts and replays them', function (): void {
    SalesKit::as($this->w->user, $this->w->company)->postJson('/api/v1/sales-quotes', [])->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');
    $payload = ['party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '5']]];
    $first = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', $payload, 'same-key')->assertCreated()->json('data.id');
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', $payload, 'same-key')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')
        ->assertJsonPath('data.id', $first);
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [...$payload, 'notes' => 'x'], 'same-key')->assertStatus(422)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REUSED');
    expect(DB::table('sales_quotes')->count())->toBe(1);
});

it('filters invoices by type and open balance', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '5']],
    ])->assertCreated();

    SalesKit::get($this->w->user, $this->w->company, 'sales-invoices?filter[open]=1')->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.id', $invoice['id']);
    SalesKit::get($this->w->user, $this->w->company, 'sales-invoices?filter[invoice_type]=return')->assertJsonPath('meta.pagination.total', 0);
    SalesKit::get($this->w->user, $this->w->company, 'sales-invoices?filter[invoice_type]=sale')->assertJsonPath('meta.pagination.total', 2);
});
