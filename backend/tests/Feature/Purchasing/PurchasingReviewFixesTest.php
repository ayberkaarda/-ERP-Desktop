<?php

declare(strict_types=1);

use App\Modules\Workflow\Events\ApprovalCompleted;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->buyer = PurchKit::user(['purchasing.price_override']);
});

/** An approved request with one stock line of 10. */
function reviewRequest(object $w): array
{
    $request = PurchKit::post($w->user, $w->company, 'purchase-requests', [
        'lines' => [['item_id' => $w->item->id, 'quantity' => '10', 'estimated_price' => '5']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/submit")->assertOk()->assertJsonPath('data.status', 'approved');

    return $request;
}

/** Ships (and approves) a return created from a source. */
function reviewShip(object $w, string $returnId): array
{
    PurchKit::post($w->user, $w->company, "purchase-returns/{$returnId}/approve")->assertOk();

    return PurchKit::post($w->user, $w->company, "purchase-returns/{$returnId}/ship")->assertOk()->json('data');
}

it('ignores an approval result of a request the document no longer waits for (finding 1)', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.require_approval_over', '50');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    PurchKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Purchase orders', 'document_type' => 'purchase_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
    $order = PurchKit::post($this->w->user, $this->w->company, 'purchase-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->json('data');
    $pending = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/submit")->assertJsonPath('data.status', 'pending_approval')->json('data');

    // A result of an older (replaced) approval request changes nothing.
    event(new ApprovalCompleted((string) Str::uuid7(), $this->w->company, $order['id'], 'purchase_order'));
    expect(DB::table('purchase_orders')->where('id', $order['id'])->value('status'))->toBe('pending_approval');

    event(new ApprovalCompleted($pending['approval_request_id'], $this->w->company, $order['id'], 'purchase_order'));
    expect(DB::table('purchase_orders')->where('id', $order['id'])->value('status'))->toBe('approved');
});

it('bounds RFQ lines of one request line together, at creation and at award (finding 2)', function (): void {
    $w = $this->w;
    $request = reviewRequest($w);
    $line = $request['lines'][0]['id'];

    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/rfq", [
        'supplier_ids' => [$w->party->id], 'lines' => [['request_line_id' => $line, 'quantity' => '10'], ['request_line_id' => $line, 'quantity' => '10']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.1.quantity']));

    $rfq = PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/rfq", [
        'supplier_ids' => [$w->party->id], 'lines' => [['request_line_id' => $line, 'quantity' => '5'], ['request_line_id' => $line, 'quantity' => '5']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/send")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [
        ['rfq_line_id' => $rfq['lines'][0]['id'], 'unit_price' => '5'], ['rfq_line_id' => $rfq['lines'][1]['id'], 'unit_price' => '5'],
    ]])->assertOk();
    // Meanwhile 5 of the 10 are ordered directly: awarding both RFQ lines (10) would exceed the request.
    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/orders", [
        'party_id' => $w->party->id, 'lines' => [['request_line_id' => $line, 'quantity' => '5']],
    ])->assertCreated();

    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/award", ['party_id' => $w->party->id])->assertStatus(422);
    expect(DB::table('purchase_orders')->where('rfq_id', $rfq['id'])->count())->toBe(0);
});

it('receives goods of an order at the order cost when booked with receive_on_invoice (finding 3)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '100']]);
    $invoice = PurchKit::post($this->buyer, $w->company, "purchase-orders/{$order['id']}/invoices", [
        'supplier_invoice_no' => 'ROI-P', 'receive_on_invoice' => true, 'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '2', 'unit_price' => '120']],
    ])->assertCreated()->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');

    expect(PurchKit::balance($w->company, '153'))->toBe('200.0000')
        ->and(PurchKit::balance($w->company, '621'))->toBe('40.0000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and($booked['lines'][0]['variance_amount'])->toBe('40.0000');
});

it('never debits more than the original line when a debit note repeats it (finding 4)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '3', '0.006667']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '3']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'TINY-1');
    expect($invoice['total'])->toBe('0.0200');
    $line = $invoice['lines'][0]['id'];
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [
        ['invoice_line_id' => $line, 'quantity' => '1'], ['invoice_line_id' => $line, 'quantity' => '1'], ['invoice_line_id' => $line, 'quantity' => '1'],
    ]])->assertCreated()->json('data');
    reviewShip($w, $return['id']);
    $debited = PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/debit")->assertOk()->json('data');
    $debit = PurchKit::get($w->user, $w->company, "purchase-invoices/{$debited['debit_invoice_id']}")->json('data');

    expect($debit['total'])->toBe('0.0200')
        ->and(array_map(static fn (array $l): string => $l['net_amount'], $debit['lines']))->toBe(['0.0100', '0.0100', '0.0000'])
        ->and(PurchKit::balance($w->company, '320'))->toBe('0.0000');
});

it('clears the accrual of a return in the warehouse it was shipped from (finding 5)', function (): void {
    $w = $this->w;
    $other = Inv::warehouse($w->company, 'SIDE');
    Inv::receive($w->company, $other->id, $w->item->id, '5', '10');
    $account = DB::table('accounts')->where('company_id', $w->company)->where('code', '197')->value('id');
    DB::table('account_determination_rules')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $w->company, 'event_key' => 'purchase.goods_received', 'priority' => 10,
        'conditions' => json_encode(['warehouse_id' => $other->id]), 'account_id' => $account, 'is_system' => false, 'is_active' => true,
        'version' => 1, 'created_at' => now(), 'updated_at' => now(),
    ]);
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'WH-R');
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", [
        'warehouse_id' => $other->id, 'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    reviewShip($w, $return['id']);
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/debit")->assertOk();

    expect(PurchKit::balance($w->company, '197'))->toBe('0.0000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000');
});

it('lets the last of several returns take the rest of the receipt cost (finding 6)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '3', '0.333333']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '3']);
    expect($receipt['cost_total'])->toBe('1.0000');

    foreach ([1, 2, 3] as $n) {
        $return = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/returns", [
            'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '1']],
        ])->assertCreated()->json('data');
        reviewShip($w, $return['id']);
    }

    expect(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('0.000000');
});

it('refuses to award an RFQ whose request was cancelled meanwhile (finding 7)', function (): void {
    $w = $this->w;
    $request = reviewRequest($w);
    $rfq = PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/rfq", ['supplier_ids' => [$w->party->id]])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/send")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [
        ['rfq_line_id' => $rfq['lines'][0]['id'], 'unit_price' => '5'],
    ]])->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');

    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/award", ['party_id' => $w->party->id])->assertStatus(422)
        ->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['request']));
    expect(DB::table('purchase_orders')->where('rfq_id', $rfq['id'])->count())->toBe(0);
});

it('shows only links and supplier lists of document types the viewer may see (finding 8)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '2', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '2']);
    PurchKit::invoiceReceipt($w, $receipt['id'], 'LNK-1');
    $viewer = Actors::user(['purchasing.orders.view']);

    $links = PurchKit::get($viewer, $w->company, "purchase-orders/{$order['id']}")->assertOk()->json('data.links');
    expect($links['invoices'])->toBe([])->and($links['receipts'])->toBe([]);
    expect(PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->json('data.links.invoices'))->toHaveCount(1);
    PurchKit::get($viewer, $w->company, "suppliers/{$w->party->id}/purchase-summary")->assertOk()->assertJsonPath('data.recent_invoices', []);
});

it('checks the view permission of invoice sources before looking them up (finding 9)', function (): void {
    $clerk = Actors::user(['purchasing.invoices.create']);
    $body = fn (string $key): array => ['party_id' => $this->w->party->id, 'supplier_invoice_no' => 'S-9', 'lines' => [[$key => (string) Str::uuid7(), 'quantity' => '1']]];

    PurchKit::post($clerk, $this->w->company, 'purchase-invoices', $body('receipt_line_id'))->assertForbidden();
    PurchKit::post($clerk, $this->w->company, 'purchase-invoices', $body('order_line_id'))->assertForbidden();
});

it('keeps the reversal stamp of a reversed invoice immutable (finding 10)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '1', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '1']);
    $booked = PurchKit::invoiceReceipt($w, $receipt['id'], 'RV-1');
    $state = static function (Closure $statement): ?string {
        try {
            DB::transaction($statement);

            return null;
        } catch (QueryException $e) {
            return is_string($e->errorInfo[0] ?? null) ? $e->errorInfo[0] : 'unknown';
        }
    };

    // Not without the booked -> reversed transition ...
    expect($state(fn () => DB::table('purchase_invoices')->where('id', $booked['id'])->update(['reversal_reason' => 'x'])))->toBe('KP001');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$booked['id']}/reverse", ['reason' => 'Wrong'])->assertOk();

    // ... and never afterwards.
    foreach (['reversal_reason' => 'Other', 'reversal_date' => '2027-06-30', 'reversed_by' => null, 'reversal_journal_entry_id' => null] as $column => $value) {
        expect($state(fn () => DB::table('purchase_invoices')->where('id', $booked['id'])->update([$column => $value])))->toBe('KP001', $column);
    }
});
