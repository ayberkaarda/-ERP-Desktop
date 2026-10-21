<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

/**
 * The router keeps controller instances between requests (as a long-running worker does). Nothing a
 * controller holds may carry the company of an earlier request: settings, warehouses and lookups
 * must be those of the company of the current request.
 */
it('applies the credit and approval policy of the company of each request, not of an earlier one', function (): void {
    // Company A: credit checks off, no approval; its routes are warmed by a full order cycle.
    $a = SalesKit::world();
    SalesKit::setting($a->company, 'sales.credit_check_mode', 'off');
    $order = SalesKit::confirmedOrder($a, [[$a->item->id, '1', '100'], [$a->service->id, '1', '5000']]);
    SalesKit::deliver($a, $order['id'], [$order['lines'][0]['id'] => '1']);
    SalesKit::get($a->user, $a->company, "customers/{$a->party->id}/exposure")->assertOk()->assertJsonPath('data.limit', null);

    // Company B, another user: credit limit 100 in block mode, approval from 1 000.
    $userB = Actors::user();
    $b = Actors::companyFor($userB, SalesKit::ALL);
    SalesKit::setting($b, 'sales.credit_check_mode', 'block');
    SalesKit::setting($b, 'sales.require_approval_over', '1000');
    $whB = SalesKit::warehouse($b, 'B-MAIN');
    $unitB = SalesKit::unit($b);
    $vatB = SalesKit::taxCode($b);
    $serviceB = SalesKit::item($b, ['code' => 'B-SETUP', 'type' => 'service', 'default_tax_code_id' => $vatB->id], $unitB);
    $stockB = SalesKit::item($b, ['code' => 'B-WIDGET', 'default_tax_code_id' => $vatB->id], $unitB);
    SalesKit::receive($b, $whB->id, $stockB->id, '5', '10');
    $partyB = SalesKit::party($b, ['name' => 'Careful']);
    DB::table('parties')->where('id', $partyB->id)->update(['risk_limit' => '100', 'risk_currency_code' => 'TRY']);

    $create = fn (string $price, array $extra = []) => SalesKit::post($userB, $b, 'sales-orders', [
        'party_id' => $partyB->id, 'document_date' => '2027-06-10', ...$extra,
        'lines' => [['item_id' => $serviceB->id, 'quantity' => '1', 'unit_price' => $price]],
    ])->assertCreated()->json('data');

    // Over the limit: blocked in B.
    $blocked = $create('500');
    SalesKit::post($userB, $b, "sales-orders/{$blocked['id']}/confirm")->assertStatus(422)->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
    SalesKit::get($userB, $b, "customers/{$partyB->id}/exposure")->assertOk()->assertJsonPath('data.limit', '100.00');

    // Within the limit but over the approval threshold: waits for approval in B.
    DB::table('parties')->where('id', $partyB->id)->update(['risk_limit' => '100000']);
    $pending = $create('2000');
    SalesKit::post($userB, $b, "sales-orders/{$pending['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'pending_approval');

    // B's own warehouse is valid for a stock order, delivery and invoice in B.
    $stock = $create('50', ['warehouse_id' => $whB->id]);
    SalesKit::patch($userB, $b, "sales-orders/{$stock['id']}", [
        'version' => $stock['version'], 'lines' => [['item_id' => $stockB->id, 'quantity' => '1', 'unit_price' => '50']],
    ])->assertOk();
    $confirmed = SalesKit::post($userB, $b, "sales-orders/{$stock['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'confirmed')->json('data');
    $wB = (object) ['company' => $b, 'user' => $userB, 'party' => $partyB];
    $delivery = SalesKit::deliver($wB, $confirmed['id'], [$confirmed['lines'][0]['id'] => '1']);
    expect($delivery['warehouse_id'])->toBe($whB->id);
    SalesKit::invoiceDelivery($wB, $delivery['id']);

    // And A still runs on A's policy afterwards.
    $again = SalesKit::confirmedOrder($a, [[$a->service->id, '1', '9000']]);
    expect($again['status'])->toBe('confirmed');
});
