<?php

declare(strict_types=1);

use App\Modules\Settings\Services\SettingsRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
});

it('replays a repeated Idempotency-Key and books an invoice only once', function (): void {
    $w = $this->w;
    $key = (string) Str::uuid7();
    $body = ['party_id' => $w->party->id, 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '10']]];
    $first = PurchKit::post($w->user, $w->company, 'purchase-orders', $body, $key)->assertCreated()->json('data.id');
    $second = PurchKit::post($w->user, $w->company, 'purchase-orders', $body, $key)->assertCreated()->json('data.id');
    expect($second)->toBe($first)->and(DB::table('purchase_orders')->where('company_id', $w->company)->count())->toBe(1);

    PurchKit::post($w->user, $w->company, "purchase-orders/{$first}/submit")->assertOk();
    $order = PurchKit::get($w->user, $w->company, "purchase-orders/{$first}")->json('data');
    $receipt = PurchKit::receive($w, $first, [$order['lines'][0]['id'] => '2']);
    // Posting again (new key) returns the posted receipt; no second stock movement.
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/post")->assertOk()->assertJsonPath('meta.replayed', true);
    expect(DB::table('stock_movements')->where('company_id', $w->company)->count())->toBe(1);

    $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", ['supplier_invoice_no' => 'IDEM-1'])->json('data');
    $bookKey = (string) Str::uuid7();
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book", [], $bookKey)->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book", [], $bookKey)->assertOk()->assertJsonPath('data.status', 'booked');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->assertJsonPath('meta.replayed', true);
    expect(DB::table('journal_entries')->where('source_type', 'purchase_invoice')->where('source_id', $invoice['id'])->count())->toBe(1);
    // Creating POSTs need the key.
    PurchKit::as($w->user, $w->company)->postJson('/api/v1/purchase-orders', $body)->assertStatus(400);
});

it('refuses a supplier invoice number used before for the same supplier until the earlier one is cancelled', function (): void {
    $w = $this->w;
    $body = fn (string $no): array => ['party_id' => $w->party->id, 'supplier_invoice_no' => $no, 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '10']]];
    $first = PurchKit::post($w->user, $w->company, 'purchase-invoices', $body('DUP-1'))->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, 'purchase-invoices', $body('DUP-1'))->assertStatus(422)
        ->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['supplier_invoice_no']));
    // Another supplier may use the same number.
    $other = PurchKit::supplier($w->company);
    PurchKit::post($w->user, $w->company, 'purchase-invoices', [...$body('DUP-1'), 'party_id' => $other->id])->assertCreated();

    $second = PurchKit::post($w->user, $w->company, 'purchase-invoices', $body('DUP-2'))->assertCreated()->json('data');
    PurchKit::patch($w->user, $w->company, "purchase-invoices/{$second['id']}", ['supplier_invoice_no' => 'DUP-1', 'version' => $second['version']])->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$first['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
    PurchKit::patch($w->user, $w->company, "purchase-invoices/{$second['id']}", ['supplier_invoice_no' => 'DUP-1', 'version' => $second['version']])->assertOk();

    // Booking needs a supplier invoice number.
    $none = PurchKit::post($w->user, $w->company, 'purchase-invoices', [...$body('X'), 'supplier_invoice_no' => null])->json('data');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$none['id']}/book")->assertStatus(422)
        ->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['supplier_invoice_no']));
});

it('refuses illegal transitions and edits outside draft', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '10']]);
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/submit")->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    PurchKit::patch($w->user, $w->company, "purchase-orders/{$order['id']}", ['notes' => 'x', 'version' => $order['version']])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-orders/{$order['id']}")->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '2']);
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/cancel")->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/revise", ['version' => $order['version'] + 5])->assertStatus(409);
    $current = PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->json('data.version');
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/revise", ['version' => $current])->assertStatus(422)
        ->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/cancel", ['reason' => 'x', 'date' => '2027-06-01'])->assertStatus(422);

    $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", ['supplier_invoice_no' => 'T-1'])->json('data');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['reason' => 'x'])->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns")->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/cancel")->assertStatus(422);

    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns")->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/debit")->assertStatus(422);
    // An invoice with returns cannot be reversed.
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['reason' => 'x'])->assertStatus(422);
    // Returns never exceed what was invoiced.
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']]])
        ->assertStatus(422);
});

it('bounds receipts by the order plus the over-receipt tolerance and gates direct receipts', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '10', '10']]);
    $line = $order['lines'][0]['id'];
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/receipts", ['lines' => [['order_line_id' => $line, 'quantity' => '11']]])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.quantity']));
    PurchKit::setting($w->company, 'purchasing.allow_over_receipt_percent', 10);
    PurchKit::receive($w, $order['id'], [$line => '11']);
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'received');
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/receipts", ['lines' => [['order_line_id' => $line, 'quantity' => '0.5']]])->assertStatus(422);

    $direct = ['party_id' => $w->party->id, 'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '7', 'lot_no' => null]]];
    PurchKit::post($w->user, $w->company, 'purchase-receipts', $direct)->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['order_id']));
    PurchKit::setting($w->company, 'purchasing.allow_direct_receipt', true);
    $receipt = PurchKit::post($w->user, $w->company, 'purchase-receipts', $direct)->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/post")->assertOk()->assertJsonPath('data.cost_total', '7.0000');
    // Services are not received.
    PurchKit::post($w->user, $w->company, 'purchase-receipts', [...$direct, 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '1']]])
        ->assertStatus(422);
});

it('lists with filters, sorts and search and refuses unknown filters', function (): void {
    $w = $this->w;
    $a = PurchKit::approvedOrder($w, [[$w->item->id, '1', '10']], ['document_date' => '2027-06-01', 'notes' => 'alpha']);
    $other = PurchKit::supplier($w->company, ['name' => 'Other Supplier']);
    PurchKit::post($w->user, $w->company, 'purchase-orders', [
        'party_id' => $other->id, 'document_date' => '2027-06-12', 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '99']],
    ])->assertCreated();

    PurchKit::get($w->user, $w->company, 'purchase-orders?filter[status]=approved')->assertOk()->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.id', $a['id'])->assertJsonPath('data.0.line_count', 1);
    PurchKit::get($w->user, $w->company, "purchase-orders?filter[supplier]={$other->id}")->assertJsonPath('meta.pagination.total', 1);
    PurchKit::get($w->user, $w->company, "purchase-orders?filter[item_id]={$w->item->id}")->assertJsonPath('meta.pagination.total', 1);
    PurchKit::get($w->user, $w->company, 'purchase-orders?filter[date_from]=2027-06-05&filter[date_to]=2027-06-30')->assertJsonPath('meta.pagination.total', 1);
    PurchKit::get($w->user, $w->company, 'purchase-orders?q=alpha')->assertJsonPath('meta.pagination.total', 1);
    PurchKit::get($w->user, $w->company, 'purchase-orders?sort=-total')->assertOk()->assertJsonPath('data.0.total', '118.8000');
    PurchKit::get($w->user, $w->company, 'purchase-orders?filter[nope]=1')->assertStatus(422);
    PurchKit::get($w->user, $w->company, 'purchase-orders?sort=nope')->assertStatus(422);
    PurchKit::get($w->user, $w->company, 'purchase-orders?filter[date_from]=junk')->assertStatus(422);
});

it('exports lists as CSV and XLSX with a formula guard and a row cap', function (): void {
    $w = $this->w;
    $supplier = PurchKit::supplier($w->company, ['name' => '=HYPERLINK("x")', 'legal_name' => null]);
    PurchKit::post($w->user, $w->company, 'purchase-orders', [
        'party_id' => $supplier->id, 'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->assertCreated();

    $csv = PurchKit::as($w->user, $w->company)->get('/api/v1/purchase-orders/export?format=csv');
    $csv->assertOk();
    $content = $csv->streamedContent();
    expect($content)->toStartWith("\xEF\xBB\xBF")->toContain('withholding_total')->toContain("'=HYPERLINK");
    $xlsx = PurchKit::as($w->user, $w->company)->get('/api/v1/purchase-orders/export?format=xlsx')->assertOk();
    expect((string) $xlsx->headers->get('content-disposition'))->toContain('.xlsx');
    config(['purchasing.export_max_rows' => 0]);
    PurchKit::get($w->user, $w->company, 'purchase-orders/export')->assertStatus(422);
});

it('previews totals and serves the print model', function (): void {
    $w = $this->w;
    PurchKit::post($w->user, $w->company, 'purchase-documents/preview-totals', [
        'party_id' => $w->party->id,
        'lines' => [['item_id' => $w->service->id, 'quantity' => '3', 'unit_price' => '33.33', 'withholding_code_id' => $w->withholding->id]],
    ])->assertOk()
        ->assertJsonPath('data.totals.subtotal', '99.99')
        ->assertJsonPath('data.totals.tax_total', '20.00')
        ->assertJsonPath('data.totals.withholding_total', '10.00')
        ->assertJsonPath('data.taxes.0.base', '99.99');
    $this->assertDatabaseCount('purchase_orders', 0);

    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '10']]);
    $print = PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}/print-model")->assertOk()->json('data');
    expect($print['document_type'])->toBe('purchase_order')
        ->and($print['lines'][0]['item_code'])->toBe('WIDGET')
        ->and($print['party']['name'])->toBe($w->party->name)
        ->and($print['totals']['total'])->toBe('24.0000')
        ->and($print['taxes'][0]['tax'])->toBe('4.00');
});

it('revises an approved order before receipts and deletes drafts', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '10']]);
    $revised = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/revise", [
        'version' => $order['version'], 'lines' => [['id' => $order['lines'][0]['id'], 'item_id' => $w->item->id, 'quantity' => '5']],
    ])->assertOk()->assertJsonPath('data.status', 'approved')->assertJsonPath('data.revision', 2)->json('data');
    expect($revised['lines'][0]['id'])->toBe($order['lines'][0]['id'])->and($revised['lines'][0]['quantity'])->toBe('5.000000')
        ->and($revised['number'])->toBe($order['number']);

    $draft = PurchKit::post($w->user, $w->company, 'purchase-orders', ['party_id' => $w->party->id, 'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '1']]])->json('data');
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-orders/{$draft['id']}?version=99")->assertStatus(409);
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-orders/{$draft['id']}")->assertNoContent();
    // A line without a price is refused (no purchase price list).
    PurchKit::post($w->user, $w->company, 'purchase-orders', ['party_id' => $w->party->id, 'lines' => [['item_id' => $w->item->id, 'quantity' => '1']]])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.unit_price']));
});

it('registers the settings with labels in all four locales', function (): void {
    $keys = array_keys(app(SettingsRegistry::class)->all());
    expect($keys)->toContain('purchasing.match_mode', 'purchasing.allow_direct_receipt', 'purchasing.invoice_approval_over');

    foreach (['tr', 'en', 'de', 'fr'] as $locale) {
        foreach (array_filter($keys, static fn (string $k): bool => str_starts_with($k, 'purchasing.')) as $key) {
            expect(trans()->hasForLocale('settings::registry.'.$key, $locale))->toBeTrue("{$locale}: {$key}");
        }
    }

    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'block');
    expect(DB::table('settings')->where('key', 'purchasing.match_mode')->exists())->toBeTrue();
});
