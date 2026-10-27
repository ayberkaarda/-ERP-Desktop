<?php

declare(strict_types=1);

use App\Modules\Purchasing\Events\PurchaseInvoiceBooked;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->buyer = PurchKit::user(['purchasing.price_override']);
});

/**
 * A draft invoice of a received order line at another price (4 x 26 against an order at 25).
 *
 * @return array<string, mixed>
 */
function purchVarianceInvoice(object $t, string $price = '26', string $number = 'M-1'): array
{
    $order = PurchKit::approvedOrder($t->w, [[$t->w->item->id, '4', '25']]);
    $receipt = PurchKit::receive($t->w, $order['id'], [$order['lines'][0]['id'] => '4']);

    return PurchKit::post($t->buyer, $t->w->company, "purchase-receipts/{$receipt['id']}/invoice", [
        'document_date' => '2027-06-13', 'supplier_invoice_no' => $number,
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '4', 'unit_price' => $price]],
    ])->assertCreated()->json('data');
}

it('blocks a price variance in block mode unless an authorized user overrides it with a reason', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'block');
    $invoice = purchVarianceInvoice($this);

    $failed = PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/book")->assertStatus(422)
        ->assertJsonPath('errors.code', 'purchasing.match_failed')
        ->assertJsonPath('errors.details.status', 'price_variance')
        ->assertJsonPath('errors.details.lines.0.order_price', '25.000000')
        ->assertJsonPath('errors.details.lines.0.invoice_price', '26.000000')
        ->assertJsonPath('errors.details.lines.0.price_difference_percent', '4.0000');
    expect($failed->json('errors.details.mode'))->toBe('block')
        ->and(DB::table('purchase_invoices')->where('id', $invoice['id'])->value('status'))->toBe('draft')
        ->and(DB::table('journal_entries')->where('source_id', $invoice['id'])->exists())->toBeFalse();

    // A reason without the permission, or the permission without a reason, is not enough.
    PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/book", ['match_override_reason' => 'Agreed'])
        ->assertStatus(422)->assertJsonPath('errors.code', 'purchasing.match_failed');
    $overrider = PurchKit::user(['purchasing.match_override']);
    PurchKit::post($overrider, $this->w->company, "purchase-invoices/{$invoice['id']}/book")->assertStatus(422);

    $booked = PurchKit::post($overrider, $this->w->company, "purchase-invoices/{$invoice['id']}/book", ['match_override_reason' => 'Price rise agreed'])
        ->assertOk()->assertJsonPath('data.status', 'booked')->assertJsonPath('data.match_override_reason', 'Price rise agreed')
        ->assertJsonPath('data.match_override_by', $overrider->id)->json('data');
    $audit = PurchKit::get($this->w->user, $this->w->company, "purchase-invoices/{$booked['id']}")->json('data.audit');
    expect(collect($audit)->pluck('event')->all())->toContain('match_override');
    PurchKit::get($this->w->user, $this->w->company, "purchase-invoices/{$booked['id']}/match")->assertOk()
        ->assertJsonPath('data.status', 'price_variance')->assertJsonPath('data.lines.0.status', 'price_variance')
        ->assertJsonPath('data.override_reason', 'Price rise agreed');
});

it('accepts differences within the tolerance and ignores variances in off mode', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'block');
    PurchKit::setting($this->w->company, 'purchasing.match_price_tolerance_percent', '5');
    $invoice = purchVarianceInvoice($this);
    expect($invoice['match_status'])->toBe('matched');
    PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->assertJsonMissingPath('meta.warnings');

    PurchKit::setting($this->w->company, 'purchasing.match_price_tolerance_percent', '0');
    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'off');
    $second = purchVarianceInvoice($this, '30', 'M-2');
    $booked = PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$second['id']}/book")->assertOk();
    expect($booked->json('meta.warnings'))->toBeNull()->and($booked->json('data.match_status'))->toBe('price_variance');
});

it('flags invoiced quantities above the order as a quantity variance', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'block');
    $order = PurchKit::approvedOrder($this->w, [[$this->w->service->id, '2', '100']]);
    $invoice = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/invoices", [
        'supplier_invoice_no' => 'Q-1', 'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '3']],
    ])->assertCreated()->assertJsonPath('data.match_status', 'qty_variance')->json('data');

    PurchKit::get($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/match")->assertOk()
        ->assertJsonPath('data.lines.0.status', 'qty_variance')->assertJsonPath('data.lines.0.invoiced', '3.000000')
        ->assertJsonPath('data.lines.0.reference', '2.000000');
    PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/book")->assertStatus(422)
        ->assertJsonPath('errors.details.status', 'qty_variance');

    PurchKit::setting($this->w->company, 'purchasing.match_qty_tolerance_percent', '50');
    PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->assertJsonPath('data.match_status', 'matched');
});

it('sends large orders to approval and approves them through the workflow', function (): void {
    Event::fake([PurchaseInvoiceBooked::class]);
    PurchKit::setting($this->w->company, 'purchasing.require_approval_over', '1000');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage', 'purchasing.orders.view']);
    PurchKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Purchase orders', 'document_type' => 'purchase_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();

    $small = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    expect($small['status'])->toBe('approved');

    $order = PurchKit::post($this->w->user, $this->w->company, 'purchase-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '10', 'unit_price' => '100']],
    ])->json('data');
    $pending = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/submit")->assertOk()
        ->assertJsonPath('data.status', 'pending_approval')->json('data');
    // A pending order cannot be received.
    PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/receipts")->assertStatus(422);

    $request = PurchKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->assertOk()->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'approve', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    PurchKit::get($this->w->user, $this->w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'approved');
    expect(DB::table('notifications')->where('user_id', $this->w->user->id)->where('type', 'purchasing.order_approval_granted')->exists())->toBeTrue();

    // Rejected: back to draft with a comment.
    $other = PurchKit::post($this->w->user, $this->w->company, 'purchase-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '20', 'unit_price' => '100']],
    ])->json('data');
    $pending = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$other['id']}/submit")->json('data');
    $request = PurchKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'reject', 'comment' => 'No', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    PurchKit::get($this->w->user, $this->w->company, "purchase-orders/{$other['id']}")->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.approval_comment', fn (?string $c): bool => $c !== null);
});

it('returns a revised sent order to sent once its new approval is granted', function (): void {
    $order = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    $sent = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/send")->assertOk()->json('data');
    PurchKit::setting($this->w->company, 'purchasing.require_approval_over', '500');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    PurchKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Purchase orders', 'document_type' => 'purchase_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();

    $pending = PurchKit::post($this->w->user, $this->w->company, "purchase-orders/{$order['id']}/revise", [
        'version' => $sent['version'], 'lines' => [['id' => $sent['lines'][0]['id'], 'item_id' => $this->w->item->id, 'quantity' => '9']],
    ])->assertOk()->assertJsonPath('data.status', 'pending_approval')->assertJsonPath('data.revision', 2)->json('data');
    $request = PurchKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'approve', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    PurchKit::get($this->w->user, $this->w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'sent')
        ->assertJsonPath('data.lines.0.quantity', '9.000000');
});

it('books a large invoice only after approval, keeping the override given at submission', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.invoice_approval_over', '50');
    PurchKit::setting($this->w->company, 'purchasing.match_mode', 'block');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    PurchKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Supplier invoices', 'document_type' => 'purchase_invoice',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
    $invoice = purchVarianceInvoice($this);
    $clerk = PurchKit::user(['purchasing.match_override']);

    $pending = PurchKit::post($clerk, $this->w->company, "purchase-invoices/{$invoice['id']}/book", ['match_override_reason' => 'Agreed'])->assertOk()
        ->assertJsonPath('data.status', 'pending_approval')->assertJsonPath('data.number', null)
        ->assertJsonPath('meta.warnings.0.code', 'purchasing.approval_pending')->json('data');
    expect(DB::table('journal_entries')->where('source_id', $invoice['id'])->exists())->toBeFalse();
    // Pending invoices are not edited.
    PurchKit::patch($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}", ['notes' => 'x', 'version' => $pending['version']])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    $request = PurchKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'approve', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    $booked = PurchKit::get($this->w->user, $this->w->company, "purchase-invoices/{$invoice['id']}")->assertJsonPath('data.status', 'booked')->json('data');
    expect($booked['number'])->toStartWith('PIN2027')->and($booked['journal_entry_id'])->not->toBeNull()
        ->and(DB::table('notifications')->where('user_id', $this->buyer->id)->where('type', 'purchasing.invoice_approval_granted')->exists())->toBeTrue();
});

it('approves purchase requests above their threshold through the workflow and rejects them', function (): void {
    PurchKit::setting($this->w->company, 'purchasing.request_approval_over', '100');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    PurchKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Purchase requests', 'document_type' => 'purchase_request',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
    $request = PurchKit::post($this->w->user, $this->w->company, 'purchase-requests', [
        'needed_by' => '2027-07-01', 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '5', 'estimated_price' => '30']],
    ])->assertCreated()->assertJsonPath('data.estimated_total', '150.0000')->json('data');
    $pending = PurchKit::post($this->w->user, $this->w->company, "purchase-requests/{$request['id']}/submit")->assertOk()
        ->assertJsonPath('data.status', 'pending_approval')->json('data');
    expect($pending['number'])->toStartWith('PRQ2027');

    $approval = PurchKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'reject', 'comment' => 'Later', 'version' => $approval['version'], 'step' => $approval['current_step']])->assertOk();
    $rejected = PurchKit::get($this->w->user, $this->w->company, "purchase-requests/{$request['id']}")->assertJsonPath('data.status', 'rejected')->json('data');

    // Editing a rejected request reopens it; submitting again goes back to approval, then approved.
    PurchKit::patch($this->w->user, $this->w->company, "purchase-requests/{$request['id']}", ['notes' => 'Cheaper', 'version' => $rejected['version']])
        ->assertOk()->assertJsonPath('data.status', 'draft');
    $again = PurchKit::post($this->w->user, $this->w->company, "purchase-requests/{$request['id']}/submit")->assertJsonPath('data.status', 'pending_approval')->json('data');
    $approval = PurchKit::get($approver, $this->w->company, "approvals/{$again['approval_request_id']}")->json('data');
    PurchKit::post($approver, $this->w->company, "approvals/{$again['approval_request_id']}/decisions", ['decision' => 'approve', 'version' => $approval['version'], 'step' => $approval['current_step']])->assertOk();
    PurchKit::get($this->w->user, $this->w->company, "purchase-requests/{$request['id']}")->assertJsonPath('data.status', 'approved')
        ->assertJsonPath('data.number', $pending['number']);
});
