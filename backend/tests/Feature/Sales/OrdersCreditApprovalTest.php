<?php

declare(strict_types=1);

use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
});

function draftOrder(object $w, string $qty = '1', string $price = '100', array $header = []): array
{
    return SalesKit::post($w->user, $w->company, 'sales-orders', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', ...$header,
        'lines' => [['item_id' => $w->item->id, 'quantity' => $qty, 'unit_price' => $price]],
    ])->assertCreated()->json('data');
}

it('warns over the credit limit in warn mode and confirms', function (): void {
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100', 'risk_currency_code' => 'TRY']);
    $order = draftOrder($this->w);

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()
        ->assertJsonPath('data.status', 'confirmed')
        ->assertJsonPath('meta.warnings.0.code', 'sales.credit_limit_exceeded')
        ->assertJsonPath('meta.warnings.0.details.limit', '100.00')
        ->assertJsonPath('meta.warnings.0.details.document', '120.00')
        ->assertJsonPath('meta.warnings.0.details.available', '-20.00');
});

it('blocks over the limit in block mode, with an audited override for sales.credit_override', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '200', 'risk_currency_code' => 'TRY']);
    $first = draftOrder($this->w);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$first['id']}/confirm")->assertOk();
    $order = draftOrder($this->w);

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded')
        ->assertJsonPath('errors.details.exposure', '120.00')
        ->assertJsonPath('errors.details.document', '120.00')
        ->assertJsonPath('errors.details.total', '240.00')
        ->assertJsonPath('errors.details.limit', '200.00');
    // A rejected confirmation burns no number.
    expect(DB::table('sales_orders')->where('id', $order['id'])->value('status'))->toBe('draft')
        ->and(DB::table('sales_orders')->where('id', $order['id'])->value('number'))->toBeNull();

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Known customer'])
        ->assertStatus(422)->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');

    $manager = SalesKit::user(['sales.credit_override']);
    SalesKit::post($manager, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422);
    SalesKit::post($manager, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Known customer'])->assertOk()
        ->assertJsonPath('data.status', 'confirmed')
        ->assertJsonPath('data.number', 'ORD2027000000002')
        ->assertJsonPath('data.credit_override_reason', 'Known customer')
        ->assertJsonPath('data.credit_override_by', $manager->id)
        ->assertJsonPath('meta.warnings.0.details.overridden', true);
    expect(DB::table('activity_log')->where('subject_id', $order['id'])->where('event', 'credit_override')->exists())->toBeTrue();
});

it('skips the check in off mode and treats parties without a limit as unlimited', function (): void {
    $order = draftOrder($this->w, '5', '100000');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()->assertJsonMissingPath('meta.warnings');

    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'off');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '1']);
    $order = draftOrder($this->w);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()->assertJsonMissingPath('meta.warnings');
});

it('computes exposure from open invoices and open orders in the risk currency', function (): void {
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2027-06-15', 'forex_buying' => '30.000000', 'forex_selling' => '30.000000']);
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '50', 'risk_currency_code' => 'USD']);
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '5', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    SalesKit::invoiceDelivery($this->w, $delivery['id']);

    // Invoice 2 x 120 = 240 open; order 3 x 120 = 360 not invoiced: 600 TRY = 20 USD.
    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure")->assertOk()
        ->assertJson(['data' => ['currency' => 'USD', 'limit' => '50.00', 'open_invoices' => '8.00', 'open_orders' => '12.00', 'total' => '20.00', 'available' => '30.00']]);

    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/sales-summary")->assertOk()
        ->assertJsonPath('data.invoices.count', 1)
        ->assertJsonPath('data.invoices.invoiced_total', '240.00')
        ->assertJsonPath('data.invoices.balance_due', '240.00')
        ->assertJsonPath('data.orders.open_value', '360.00')
        ->assertJsonPath('data.recent_orders.0.id', $order['id']);

    SalesKit::get($this->w->user, $this->w->company, 'customers/'.Str::uuid7().'/exposure')->assertNotFound();
});

it('sends large orders to approval and confirms them when approved', function (): void {
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '1000');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage', 'sales.orders.view']);
    SalesKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Sales orders', 'document_type' => 'sales_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();

    $small = draftOrder($this->w, '1', '100');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$small['id']}/confirm")->assertJsonPath('data.status', 'confirmed');

    $order = draftOrder($this->w, '9', '100');
    $pending = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()
        ->assertJsonPath('data.status', 'pending_approval')->json('data');
    expect($pending['approval_request_id'])->not->toBeNull()
        ->and($pending['lines'][0]['reservation_id'])->toBeNull();

    $request = SalesKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->assertOk()->json('data');
    SalesKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'approve', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    $confirmed = SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'confirmed')->json('data');
    expect($confirmed['lines'][0]['reservation_id'])->not->toBeNull()
        ->and(DB::table('notifications')->where('user_id', $this->w->user->id)->where('type', 'sales.order_approval_granted')->exists())->toBeTrue();
});

it('returns a rejected order to draft and notifies the creator', function (): void {
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '50');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    SalesKit::post($approver, $this->w->company, 'approval-flows', [
        'name' => 'Sales orders', 'document_type' => 'sales_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
    $order = draftOrder($this->w);
    $pending = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->json('data');

    $request = SalesKit::get($approver, $this->w->company, "approvals/{$pending['approval_request_id']}")->assertOk()->json('data');
    SalesKit::post($approver, $this->w->company, "approvals/{$pending['approval_request_id']}/decisions", ['decision' => 'reject', 'comment' => 'No', 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.approval_comment', fn (?string $c): bool => $c !== null);
    expect(DB::table('notifications')->where('user_id', $this->w->user->id)->where('type', 'sales.order_approval_rejected')->exists())->toBeTrue();
});

it('confirms at once through the approval engine when no flow is configured', function (): void {
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '50');
    $order = draftOrder($this->w);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'confirmed');
});

it('reserves on confirm, consumes on delivery and releases on close', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '4', '100']]);
    $reservation = $order['lines'][0]['reservation_id'];
    expect(DB::table('stock_reservations')->where('id', $reservation)->value('status'))->toBe('active')
        ->and((string) DB::table('stock_balances')->where('item_id', $this->w->item->id)->sum('reserved'))->toStartWith('4');

    SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '1']);
    expect((string) DB::table('stock_reservations')->where('id', $reservation)->value('quantity'))->toBe('3.000000');

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/close")->assertOk()->assertJsonPath('data.status', 'closed')
        ->assertJsonPath('data.lines.0.reservation_id', null);
    expect(DB::table('stock_reservations')->where('id', $reservation)->value('status'))->toBe('released')
        ->and((float) DB::table('stock_balances')->where('item_id', $this->w->item->id)->sum('reserved'))->toBe(0.0);
});

it('releases reservations on cancel and refuses cancel after a delivery', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
    expect(DB::table('stock_reservations')->where('id', $order['lines'][0]['reservation_id'])->value('status'))->toBe('released');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');

    $other = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    SalesKit::deliver($this->w, $other['id'], [$other['lines'][0]['id'] => '1']);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$other['id']}/cancel")->assertStatus(422);
});

it('refuses a hard reservation beyond stock and keeps the order a draft; soft ones warn', function (): void {
    Inv::policy($this->w->company, $this->w->wh->id, 'hard');
    $order = draftOrder($this->w, '11');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422);
    expect(DB::table('sales_orders')->where('id', $order['id'])->value('status'))->toBe('draft');

    Inv::policy($this->w->company, $this->w->wh->id, 'soft');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()
        ->assertJsonPath('meta.warnings.0.code', 'sales.reservation_shortage')
        ->assertJsonPath('meta.warnings.0.shortage', '1.000000');
});

it('does not reserve when the setting is off or the warehouse has no reservations', function (): void {
    SalesKit::setting($this->w->company, 'sales.reserve_on_confirm', false);
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    expect($order['lines'][0]['reservation_id'])->toBeNull();

    SalesKit::setting($this->w->company, 'sales.reserve_on_confirm', true);
    Inv::policy($this->w->company, $this->w->wh->id, 'none');
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    expect($order['lines'][0]['reservation_id'])->toBeNull();
});

it('revises a confirmed order before deliveries, re-reserving, and not after', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $old = $order['lines'][0]['reservation_id'];

    $revised = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/revise", [
        'version' => $order['version'], 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '3', 'unit_price' => '100']],
    ])->assertOk()->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.revision', 2)->assertJsonPath('data.total', '360.0000')->json('data');
    expect(DB::table('stock_reservations')->where('id', $old)->value('status'))->toBe('released')
        ->and((string) DB::table('stock_reservations')->where('id', $revised['lines'][0]['reservation_id'])->value('quantity'))->toBe('3.000000')
        ->and($revised['number'])->toBe($order['number']);

    SalesKit::deliver($this->w, $order['id'], [$revised['lines'][0]['id'] => '1']);
    $current = SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/revise", [
        'version' => $current['version'], 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '5', 'unit_price' => '100']],
    ])->assertStatus(422);
});
