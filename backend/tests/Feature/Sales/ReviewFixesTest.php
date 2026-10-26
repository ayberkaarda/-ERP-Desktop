<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Parties\Models\PartyAddress;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Services\DeliveryService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
});

/** An approval flow for sales orders decided by $approver. */
function reviewApprovalFlow(object $w, mixed $approver): void
{
    SalesKit::post($approver, $w->company, 'approval-flows', [
        'name' => 'Sales orders', 'document_type' => 'sales_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
}

function reviewDecide(object $w, mixed $approver, string $requestId, string $decision): void
{
    $request = SalesKit::get($approver, $w->company, "approvals/{$requestId}")->assertOk()->json('data');
    SalesKit::post($approver, $w->company, "approvals/{$requestId}/decisions", ['decision' => $decision, 'version' => $request['version'], 'step' => $request['current_step']])->assertOk();
}

function reviewServiceOrder(object $w, string $price): array
{
    return SalesKit::post($w->user, $w->company, 'sales-orders', [
        'party_id' => $w->party->id, 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => $price]],
    ])->assertCreated()->json('data');
}

it('counts orders pending approval as exposure (finding 1)', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '10');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100', 'risk_currency_code' => 'TRY']);
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    reviewApprovalFlow($this->w, $approver);

    $first = reviewServiceOrder($this->w, '50');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$first['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $second = reviewServiceOrder($this->w, '50');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$second['id']}/confirm")->assertStatus(422)->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
});

it('rechecks credit when an approval completes and does not confirm over the limit (finding 1)', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '10');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100', 'risk_currency_code' => 'TRY']);
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    reviewApprovalFlow($this->w, $approver);
    $order = reviewServiceOrder($this->w, '50');
    $pending = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertOk()->json('data');

    // Meanwhile the customer was invoiced 60 (invoices need no approval).
    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '40']],
    ])->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue", ['credit_override_reason' => 'x'])->assertStatus(422);
    DB::table('sales_orders')->where('id', $order['id'])->update(['status' => 'draft']);
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk();
    DB::table('sales_orders')->where('id', $order['id'])->update(['status' => 'pending_approval']);

    reviewDecide($this->w, $approver, $pending['approval_request_id'], 'approve');
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.approval_comment', fn (?string $c): bool => $c !== null && $c !== '');
});

it('aggregates order line quantities before delivery bounds (finding 3)', function (): void {
    SalesKit::receive($this->w->company, $this->w->wh->id, $this->w->item->id, '10', '50');
    SalesKit::setting($this->w->company, 'sales.reserve_on_confirm', false);
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '10', '100']]);
    $line = $order['lines'][0]['id'];
    SalesKit::deliver($this->w, $order['id'], [$line => '5']);

    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'deliver_on_invoice' => true,
        'lines' => [['order_line_id' => $line, 'quantity' => '3'], ['order_line_id' => $line, 'quantity' => '3']],
    ])->assertStatus(422);
    expect((string) DB::table('sales_order_lines')->where('id', $line)->value('delivered_quantity'))->toBe('5.000000');
});

it('refuses source lines in another currency (finding 4)', function (): void {
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2027-06-15', 'forex_buying' => '30', 'forex_selling' => '30']);
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);

    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'currency_code' => 'USD', 'lines' => [['delivery_line_id' => $delivery['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['currency_code']));
});

it('authorizes the cancellation against the delivery as locked (finding 5)', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    $draft = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries")->json('data');
    app(CompanyContext::class)->set($this->w->company);
    $stale = SalesDelivery::query()->findOrFail($draft['id']);
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$draft['id']}/post")->assertOk();
    $clerk = Actors::user(['sales.deliveries.view', 'sales.deliveries.update']);
    app(CompanyContext::class)->set($this->w->company);

    expect(fn () => app(DeliveryService::class)->cancel($stale, null, 'x', null, $clerk))->toThrow(AuthorizationException::class);
    expect(DB::table('sales_deliveries')->where('id', $draft['id'])->value('status'))->toBe('posted');
});

it('requires view permission on every source document of an invoice (finding 6)', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $payload = ['party_id' => $this->w->party->id, 'lines' => [['delivery_line_id' => $delivery['lines'][0]['id'], 'quantity' => '1']]];
    $biller = Actors::user(['sales.invoices.view', 'sales.invoices.create', 'sales.invoices.update']);

    SalesKit::post($biller, $this->w->company, 'sales-invoices', $payload)->assertForbidden();
    $draft = SalesKit::post($biller, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '5']],
    ])->assertCreated()->json('data');
    SalesKit::patch($biller, $this->w->company, "sales-invoices/{$draft['id']}", ['version' => 1, ...$payload])->assertForbidden();
    SalesKit::patch($biller, $this->w->company, "sales-invoices/{$draft['id']}", ['version' => 1, 'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '1']]])->assertForbidden();

    SalesKit::post(Actors::user(['sales.invoices.create', 'sales.deliveries.view']), $this->w->company, 'sales-invoices', $payload)->assertCreated();
});

it('accepts only serials of the original delivery that no other return holds (finding 8)', function (): void {
    $serial = SalesKit::item($this->w->company, ['code' => 'PHONE', 'tracking' => 'serial', 'default_tax_code_id' => $this->w->vat->id], $this->w->unit);
    SalesKit::receive($this->w->company, $this->w->wh->id, $serial->id, '3', '100', ['serials' => ['S1', 'S2', 'S3']]);
    $order = SalesKit::confirmedOrder($this->w, [[$serial->id, '2', '300']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", [
        'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '2', 'serial_numbers' => ['S1', 'S2']]],
    ])->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk();
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $line = $invoice['lines'][0]['id'];
    $return = fn (array $serials) => SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $line, 'quantity' => '1', 'serial_numbers' => $serials]],
    ]);

    $return(['S3'])->assertStatus(422);
    $return(['FAKE'])->assertStatus(422);
    $return(['S1'])->assertCreated();
    $return(['S1'])->assertStatus(422);
    $return(['S2'])->assertCreated();
});

it('returns the stored base quantity even if the unit conversion changed (finding 9)', function (): void {
    $box = SalesKit::unit($this->w->company, 'BOX');
    Catalog::itemUnit($this->w->company, $this->w->item, $box, '10');
    $order = SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'unit_id' => $box->id, 'quantity' => '1', 'unit_price' => '500']],
    ])->json('data');
    $order = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->json('data');
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '1']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    DB::table('item_units')->where('item_id', $this->w->item->id)->where('unit_id', $box->id)->update(['factor' => '12']);

    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->assertJsonPath('data.lines.0.base_quantity', '10.000000')->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/approve")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertOk();
    expect(Inv::onHand($this->w->company, $this->w->item->id, $this->w->wh->id))->toBe('10.000000');
});

it('never credits more than the original invoice across partial returns (finding 10)', function (): void {
    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '2', 'unit_price' => '0.03']],
    ])->json('data');
    $invoice = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()->assertJsonPath('data.total', '0.0700')->json('data');
    $credited = [];

    foreach ([1, 2] as $n) {
        $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
            'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
        ])->assertCreated()->json('data');
        SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/approve")->assertOk();
        SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertOk();
        $note = SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/credit")->assertOk()->json('data.credit_invoice_id');
        $credited[] = SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$note}")->json('data');
    }

    $sum = fn (string $key): string => (string) SalesKit::dec($credited[0][$key])->plus($credited[1][$key]);
    expect($sum('total'))->toBe('0.0700')->and($sum('tax_total'))->toBe('0.0100')->and($sum('subtotal'))->toBe('0.0600')
        ->and($sum('total_local'))->toBe('0.0700')
        ->and(SalesKit::balance($this->w->company, '120'))->toBe('0.0000');
});

it('restores a usable reservation when a delivery is cancelled (finding 11)', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $line = $order['lines'][0]['id'];
    $delivery = SalesKit::deliver($this->w, $order['id'], [$line => '2']);
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/cancel", ['reason' => 'Wrong goods'])->assertOk();

    $again = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries")->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$again['id']}/post")->assertOk();
    $reservation = DB::table('sales_order_lines')->where('id', $line)->value('reservation_id');
    expect($reservation === null || DB::table('stock_reservations')->where('id', $reservation)->value('status') !== 'active')->toBeTrue()
        ->and((float) DB::table('stock_balances')->where('item_id', $this->w->item->id)->sum('reserved'))->toBe(0.0);
});

it('revises an order pending approval by replacing its approval request (finding 12)', function (): void {
    SalesKit::setting($this->w->company, 'sales.require_approval_over', '10');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    reviewApprovalFlow($this->w, $approver);
    $order = reviewServiceOrder($this->w, '50');
    $pending = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->json('data');

    $revised = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/revise", [
        'version' => $pending['version'], 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '2', 'unit_price' => '50']],
    ])->assertOk()->assertJsonPath('data.status', 'pending_approval')->assertJsonPath('data.total', '120.0000')->json('data');
    expect($revised['approval_request_id'])->not->toBe($pending['approval_request_id'])
        ->and(DB::table('approval_requests')->where('id', $pending['approval_request_id'])->value('status'))->toBe('cancelled');

    reviewDecide($this->w, $approver, $revised['approval_request_id'], 'approve');
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'confirmed');
});

it('reads other modules only through their contracts (finding 13)', function (): void {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Modules/Sales')));
    $offenders = [];

    foreach ($files as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $code = (string) file_get_contents($file->getPathname());

            if (preg_match("/(table|join)\\('(payment_terms|party_addresses|parties|stock_[a-z_]+|items|warehouses|tax_codes)\\b/", $code) === 1) {
                $offenders[] = $file->getFilename();
            }
        }
    }

    expect($offenders)->toBe([]);
});

it('snapshots the billing address and due date through contracts', function (): void {
    $term = SalesKit::in($this->w->company, fn () => PaymentTerm::factory()->create(['due_days' => 30]));
    SalesKit::in($this->w->company, fn () => PartyAddress::factory()->create([
        'party_id' => $this->w->party->id, 'type' => 'billing', 'line1' => 'Main street 1', 'city' => 'Ankara', 'country' => 'TR', 'is_default' => true,
    ]));

    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10', 'payment_term_id' => $term->id,
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '5']],
    ])->assertCreated()->assertJsonPath('data.due_date', '2027-07-10')
        ->assertJsonPath('data.billing_address.line1', 'Main street 1')->assertJsonPath('data.billing_address.city', 'Ankara');
});
