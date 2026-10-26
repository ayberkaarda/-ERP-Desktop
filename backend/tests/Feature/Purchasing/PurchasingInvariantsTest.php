<?php

declare(strict_types=1);

use App\Modules\Purchasing\Exceptions\PurchasingViolation;
use App\Modules\Purchasing\Support\Purchasing;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $order = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '3', '100']]);
    $this->order = $order;
    $this->receipt = PurchKit::receive($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $this->invoice = PurchKit::invoiceReceipt($this->w, $this->receipt['id'], 'INV-77');
});

/** SQLSTATE of the statement, or null when it passed (run in a savepoint so the test transaction survives). */
function purchSqlState(Closure $statement): ?string
{
    try {
        DB::transaction($statement);

        return null;
    } catch (QueryException $e) {
        return is_string($e->errorInfo[0] ?? null) ? $e->errorInfo[0] : 'unknown';
    }
}

it('rejects raw changes to a booked invoice except settlement and status moves', function (): void {
    $id = $this->invoice['id'];
    $update = fn (array $values): ?string => purchSqlState(fn () => DB::table('purchase_invoices')->where('id', $id)->update($values));

    expect($update(['total' => '1']))->toBe('KP001');
    expect($update(['supplier_invoice_no' => 'OTHER']))->toBe('KP001');
    expect($update(['number' => 'PIN2027999999999']))->toBe('KP001');
    expect($update(['journal_entry_id' => null]))->toBe('KP001');
    expect($update(['status' => 'draft']))->toBe('KP001');
    expect(purchSqlState(fn () => DB::table('purchase_invoices')->where('id', $id)->delete()))->toBe('KP001');
    // balance_due must stay total - withholding - paid_amount while booked.
    expect($update(['balance_due' => '1']))->toBe('23514');
    expect($update(['paid_amount' => '40', 'balance_due' => '200', 'status' => 'partially_paid']))->toBeNull();
    expect($update(['paid_amount' => '240', 'balance_due' => '0', 'status' => 'paid']))->toBeNull();
    expect($update(['e_document_status' => 'queued']))->toBeNull();
});

it('rejects raw changes to the lines of a booked invoice', function (): void {
    $line = DB::table('purchase_invoice_lines')->where('document_id', $this->invoice['id'])->first();
    $copy = (array) $line;
    $copy['id'] = (string) Str::uuid7();
    $copy['line_no'] = 9;

    expect(purchSqlState(fn () => DB::table('purchase_invoice_lines')->where('id', $line->id)->update(['unit_price' => '1'])))->toBe('KP002')
        ->and(purchSqlState(fn () => DB::table('purchase_invoice_lines')->where('id', $line->id)->update(['grni_amount' => '0'])))->toBe('KP002')
        ->and(purchSqlState(fn () => DB::table('purchase_invoice_lines')->where('id', $line->id)->delete()))->toBe('KP002')
        ->and(purchSqlState(fn () => DB::table('purchase_invoice_lines')->insert($copy)))->toBe('KP002');
});

it('rejects raw changes to a posted receipt and its lines', function (): void {
    $id = $this->receipt['id'];
    $line = DB::table('purchase_receipt_lines')->where('document_id', $id)->first();

    expect(purchSqlState(fn () => DB::table('purchase_receipts')->where('id', $id)->update(['warehouse_id' => (string) Str::uuid7()])))->toBe('KP003')
        ->and(purchSqlState(fn () => DB::table('purchase_receipts')->where('id', $id)->update(['status' => 'draft'])))->toBe('KP003')
        ->and(purchSqlState(fn () => DB::table('purchase_receipts')->where('id', $id)->delete()))->toBe('KP003')
        ->and(purchSqlState(fn () => DB::table('purchase_receipt_lines')->where('id', $line->id)->update(['quantity' => '9'])))->toBe('KP003')
        ->and(purchSqlState(fn () => DB::table('purchase_receipt_lines')->where('id', $line->id)->update(['cost_total' => '1'])))->toBe('KP003')
        ->and(purchSqlState(fn () => DB::table('purchase_receipt_lines')->where('id', $line->id)->delete()))->toBe('KP003');
});

it('enforces positive quantities, unique numbers and one booking per supplier invoice number', function (): void {
    $orderLine = DB::table('purchase_order_lines')->where('document_id', $this->order['id'])->first();
    expect(purchSqlState(fn () => DB::table('purchase_order_lines')->where('id', $orderLine->id)->update(['quantity' => '0'])))->toBe('23514')
        ->and(purchSqlState(fn () => DB::table('purchase_order_lines')->where('id', $orderLine->id)->update(['received_quantity' => '-1'])))->toBe('23514');

    $other = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '1', '10']]);
    expect(purchSqlState(fn () => DB::table('purchase_orders')->where('id', $other['id'])->update(['number' => $this->order['number']])))->toBe('23505');

    // A second invoice row of the same supplier with the same supplier number cannot exist.
    $row = (array) DB::table('purchase_invoices')->where('id', $this->invoice['id'])->first();
    $row = [...$row, 'id' => (string) Str::uuid7(), 'number' => null, 'status' => 'draft', 'journal_entry_id' => null, 'balance_due' => '0'];
    expect(purchSqlState(fn () => DB::table('purchase_invoices')->insert($row)))->toBe('23505');
    // The service maps it to a 422 on supplier_invoice_no.
    try {
        Purchasing::transaction(fn () => DB::table('purchase_invoices')->insert($row));
        $caught = null;
    } catch (PurchasingViolation $e) {
        $caught = $e;
    }
    expect($caught)->not->toBeNull()->and(array_keys($caught->fields ?? []))->toBe(['supplier_invoice_no']);
});

it('maps trigger violations to 422 through the module transaction', function (): void {
    try {
        Purchasing::transaction(fn () => DB::table('purchase_invoices')->where('id', $this->invoice['id'])->update(['total' => '1']));
        $caught = null;
    } catch (PurchasingViolation $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull()->and($caught->status())->toBe(422)->and($caught->sqlState)->toBe('KP001');
});
