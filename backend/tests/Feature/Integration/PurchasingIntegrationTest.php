<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use App\Modules\Purchasing\Services\Quantities;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
});

it('validates every purchasing integration key and rejects missing master references', function (): void {
    foreach (MasterDataIntegrity::purchasingKeys() as [$table, $column, $references]) {
        $key = DB::selectOne('SELECT convalidated, confdeltype, confupdtype FROM pg_constraint WHERE conname = ?', ["{$table}_{$column}_foreign"]);
        expect($key)->not->toBeNull("{$table}.{$column}");
        expect($key->convalidated)->toBeTrue()->and($key->confdeltype)->toBe('r')->and($key->confupdtype)->toBe('r');
    }

    expect(fn () => DB::transaction(fn () => DB::table('purchase_orders')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->w->company, 'status' => 'draft',
        'document_date' => '2027-06-10', 'party_id' => (string) Str::uuid7(), 'party_name' => 'Missing', 'currency_code' => 'TRY',
    ])))->toThrow(QueryException::class, 'purchase_orders_party_id_foreign');
});

it('audits purchasing references across companies without modifying them', function (): void {
    $other = PurchKit::company();
    $supplier = PurchKit::supplier($other);
    $order = PurchKit::approvedOrder($this->w, [[$this->w->service->id, '1', '100']]);
    DB::table('purchase_orders')->where('id', $order['id'])->update(['party_id' => $supplier->id]);

    expect((new MasterDataIntegrity(DB::connection()))->tenancyViolations())->toBe(['purchase_orders.party_id' => 1]);
});

it('serves exact return bounds including held invoices and draft returns', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '10', '50']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '10']);
    expect($receipt['lines'][0]['returnable_quantity'])->toBe('10.000000');

    $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", [
        'supplier_invoice_no' => 'BOUNDS-1',
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '4']],
    ])->assertCreated()->json('data');
    $readReceipt = fn () => PurchKit::get($w->user, $w->company, "purchase-receipts/{$receipt['id']}")->assertOk()->json('data.lines.0.returnable_quantity');
    expect($readReceipt())->toBe('6.000000')->and($invoice['lines'][0]['returnable_quantity'])->toBe('0.000000');

    $return = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/returns", [
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '2']],
    ])->assertCreated()->json('data');
    expect($readReceipt())->toBe('4.000000');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/cancel")->assertOk();
    expect($readReceipt())->toBe('6.000000');

    $invoice = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');
    expect($invoice['lines'][0]['returnable_quantity'])->toBe('4.000000');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated();
    PurchKit::get($w->user, $w->company, "purchase-invoices/{$invoice['id']}")->assertOk()->assertJsonPath('data.lines.0.returnable_quantity', '3.000000');
});

it('persists and reports the actual return warehouse including legacy null headers', function (): void {
    $w = $this->w;
    $w->user = PurchKit::user(['purchasing.reports.view']);
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '4', '50']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '4']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    DB::table('purchase_returns')->where('id', $return['id'])->update(['warehouse_id' => null]);
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk()
        ->assertJsonPath('data.warehouse_id', $w->wh->id);

    $report = fn () => PurchKit::get($w->user, $w->company,
        'purchase-reports/return-rate?date_from=2027-06-01&date_to=2027-06-30&warehouse_id='.$w->wh->id)->assertOk();
    expect($report()->json('data.0.returned_quantity'))->toBe('1.000000');
    // Previously shipped records may have a null header even though their stock issue has a warehouse.
    DB::table('purchase_returns')->where('id', $return['id'])->update(['warehouse_id' => null]);
    expect($report()->json('data.0.returned_quantity'))->toBe('1.000000');
    // Force a return valuation correction to exercise the price-variance report's return branch.
    DB::table('purchase_return_lines')->where('document_id', $return['id'])->update(['cost_total' => '55']);
    PurchKit::get($w->user, $w->company,
        'purchase-reports/price-variance?date_from=2027-06-01&date_to=2027-06-30&warehouse_id='.$w->wh->id)->assertOk()
        ->assertJsonPath('data.0.source', 'return')->assertJsonPath('data.0.variance_amount', '5.0000');
});

it('ignores attached foreign-company rows when computing source quantity holds', function (): void {
    $w = $this->w;
    $other = PurchKit::company();
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '10', '50']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '10']);
    $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", [
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '4']],
    ])->assertCreated()->json('data');
    $return = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/returns", [
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '2']],
    ])->assertCreated()->json('data');

    foreach (['purchase_invoices' => $invoice, 'purchase_returns' => $return] as $table => $document) {
        $lines = substr($table, 0, -1).'_lines';
        $line = (array) DB::table($lines)->where('document_id', $document['id'])->first();
        DB::table($lines)->insert([...$line, 'id' => (string) Str::uuid7(), 'company_id' => $other, 'line_no' => 2]);
        $header = (array) DB::table($table)->where('id', $document['id'])->first();
        $foreign = (string) Str::uuid7();
        DB::table($table)->insert([...$header, 'id' => $foreign, 'company_id' => $other]);
        DB::table($lines)->insert([...$line, 'id' => (string) Str::uuid7(), 'document_id' => $foreign]);
    }

    PurchKit::get($w->user, $w->company, "purchase-receipts/{$receipt['id']}")->assertOk()
        ->assertJsonPath('data.lines.0.returnable_quantity', '4.000000');
    PurchKit::in($w->company, function () use ($receipt): void {
        $quantities = app(Quantities::class);
        expect((string) $quantities->invoicedOnReceipt($receipt['lines'][0]['id']))->toBe('4.000000')
            ->and((string) $quantities->returnedOnReceipt($receipt['lines'][0]['id']))->toBe('2.000000');
    });
});
