<?php

declare(strict_types=1);

use App\Modules\Sales\Exceptions\SalesViolation;
use App\Modules\Sales\Support\Sales;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '3', '100']]);
    $this->delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $this->invoice = SalesKit::invoiceDelivery($this->w, $this->delivery['id']);
});

/** SQLSTATE of the statement, or null when it passed (run in a savepoint so the test transaction survives). */
function salesSqlState(Closure $statement): ?string
{
    try {
        DB::transaction($statement);

        return null;
    } catch (QueryException $e) {
        return is_string($e->errorInfo[0] ?? null) ? $e->errorInfo[0] : 'unknown';
    }
}

it('rejects raw changes to an issued invoice except settlement and status moves', function (): void {
    $id = $this->invoice['id'];
    $update = fn (array $values): ?string => salesSqlState(fn () => DB::table('sales_invoices')->where('id', $id)->update($values));

    expect($update(['total' => '1']))->toBe('KS001');
    expect($update(['party_name' => 'Other']))->toBe('KS001');
    expect($update(['number' => 'INV2027999999999']))->toBe('KS001');
    expect($update(['status' => 'draft']))->toBe('KS001');
    expect(salesSqlState(fn () => DB::table('sales_invoices')->where('id', $id)->delete()))->toBe('KS001');
    // balance_due must stay total - paid_amount while issued.
    expect($update(['balance_due' => '1']))->toBe('23514');
    expect($update(['paid_amount' => '40', 'balance_due' => '200', 'status' => 'partially_paid']))->toBeNull();
    expect($update(['paid_amount' => '240', 'balance_due' => '0', 'status' => 'paid']))->toBeNull();
    expect($update(['e_document_status' => 'queued']))->toBeNull();
});

it('rejects raw changes to the lines of an issued invoice', function (): void {
    $line = DB::table('sales_invoice_lines')->where('document_id', $this->invoice['id'])->first();
    $copy = (array) $line;
    $copy['id'] = (string) Str::uuid7();
    $copy['line_no'] = 9;

    expect(salesSqlState(fn () => DB::table('sales_invoice_lines')->where('id', $line->id)->update(['unit_price' => '1'])))->toBe('KS002')
        ->and(salesSqlState(fn () => DB::table('sales_invoice_lines')->where('id', $line->id)->delete()))->toBe('KS002')
        ->and(salesSqlState(fn () => DB::table('sales_invoice_lines')->insert($copy)))->toBe('KS002');
});

it('keeps a reversed invoice final', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/reverse", ['reason' => 'x'])->assertOk();

    expect(salesSqlState(fn () => DB::table('sales_invoices')->where('id', $this->invoice['id'])->update(['status' => 'issued', 'balance_due' => '240'])))->toBe('KS001')
        ->and(salesSqlState(fn () => DB::table('sales_invoices')->where('id', $this->invoice['id'])->update(['balance_due' => '5'])))->toBe('KS001');
});

it('lets drafts change freely', function (): void {
    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->json('data');

    expect(salesSqlState(fn () => DB::table('sales_invoice_lines')->where('document_id', $draft['id'])->update(['description' => 'Edited'])))->toBeNull()
        ->and(salesSqlState(fn () => DB::table('sales_invoices')->where('id', $draft['id'])->delete()))->toBeNull();
});

it('rejects raw changes to a posted delivery except its cancellation', function (): void {
    $id = $this->delivery['id'];
    $line = $this->delivery['lines'][0]['id'];

    expect(salesSqlState(fn () => DB::table('sales_deliveries')->where('id', $id)->update(['notes' => 'x'])))->toBe('KS003')
        ->and(salesSqlState(fn () => DB::table('sales_deliveries')->where('id', $id)->delete()))->toBe('KS003')
        ->and(salesSqlState(fn () => DB::table('sales_delivery_lines')->where('id', $line)->update(['quantity' => '1'])))->toBe('KS003')
        ->and(salesSqlState(fn () => DB::table('sales_delivery_lines')->where('id', $line)->delete()))->toBe('KS003')
        ->and(salesSqlState(fn () => DB::table('sales_deliveries')->where('id', $id)->update(['status' => 'cancelled', 'cancelled_at' => now(), 'notes' => 'x'])))->toBe('KS003')
        // A cancelled posted delivery carries the date its stock was reversed.
        ->and(salesSqlState(fn () => DB::table('sales_deliveries')->where('id', $id)->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancel_reason' => 'x'])))->toBe('23514')
        ->and(salesSqlState(fn () => DB::table('sales_deliveries')->where('id', $id)->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancel_reason' => 'x', 'reversal_date' => '2027-06-15'])))->toBeNull();
});

it('requires positive line quantities and unique numbers per document type', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->json('data');
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '10']]);

    expect(salesSqlState(fn () => DB::table('sales_quote_lines')->where('document_id', $quote['id'])->update(['quantity' => '0'])))->toBe('23514')
        ->and(salesSqlState(fn () => DB::table('sales_quote_lines')->where('document_id', $quote['id'])->update(['quantity' => '-1', 'base_quantity' => '-1'])))->toBe('23514')
        ->and(salesSqlState(fn () => DB::table('sales_order_lines')->where('document_id', $order['id'])->update(['quantity' => '0'])))->toBe('23514')
        ->and(salesSqlState(fn () => DB::table('sales_orders')->where('id', $order['id'])->update(['number' => DB::table('sales_orders')->where('id', '<>', $order['id'])->value('number')])))->toBe('23505')
        // Another document type may carry the same text.
        ->and(salesSqlState(fn () => DB::table('sales_quotes')->where('id', $quote['id'])->update(['number' => $order['number']])))->toBeNull();
});

it('turns trigger violations into 422 for the application', function (): void {
    SalesKit::patch($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}", ['version' => $this->invoice['version'], 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    $e = null;
    try {
        Sales::transaction(fn () => DB::table('sales_invoices')->where('id', $this->invoice['id'])->update(['total' => '1']));
    } catch (SalesViolation $caught) {
        $e = $caught;
    }
    expect($e)->not->toBeNull()->and($e->status())->toBe(422)->and($e->sqlState)->toBe('KS001');
});
