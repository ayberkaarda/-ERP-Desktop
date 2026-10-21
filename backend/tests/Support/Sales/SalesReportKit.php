<?php

declare(strict_types=1);

namespace Tests\Support\Sales;

use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Sales\Contracts\ReceivableSettlement;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * A hand-computable sales history for the report tests (company currency TRY, VAT 20%, clock
 * 2027-06-15, WIDGET on hand 10 at cost 50):
 * - O1 Acme 2027-06-10: WIDGET 5 x 100, SETUP 1 x 200; D1 2027-06-12 delivers 3 WIDGET (cost 150);
 *   INV1 2027-06-13 invoices D1: net 300, VAT 60, total 360;
 * - RET1 2027-06-15 returns 1 WIDGET of INV1 (cost back 50) and credits it: CRN net 100, VAT 20, total 120;
 * - INV2 Beta 2027-06-14 USD at 30.5, due 2027-07-20: SETUP 2 x 10 USD = net 20, VAT 4, total 24 USD
 *   (local net 610, VAT 122, total 732);
 * - INV3 Acme 2027-06-11: SETUP 1 x 50 (net 50, VAT 10, total 60), reversed on 2027-06-15;
 * - O2 Beta 2027-06-10: WIDGET 4 x 80; D2 2027-06-12 delivers 2 (cost 100), not invoiced;
 * - a settlement of 100 on INV1 applied on 2027-06-15 (reference PAY-1).
 * June: sales 910 (300 + 610 + 50 - 50), returns 100, net 810, VAT 162; COGS 150 + 100 - 50 = 200.
 */
final class SalesReportKit
{
    /**
     * @return object{w: object, beta: Party, o1: array<string, mixed>, o2: array<string, mixed>, d1: array<string, mixed>, d2: array<string, mixed>, inv1: array<string, mixed>, inv2: array<string, mixed>, inv3: array<string, mixed>, crn: array<string, mixed>}
     */
    public static function history(array $permissions = []): object
    {
        $w = SalesKit::world();
        $user = SalesKit::user(['sales.reports.view', ...$permissions]);
        $w->user = $user;
        $beta = SalesKit::party($w->company, ['name' => 'Beta']);

        $o1 = SalesKit::confirmedOrder($w, [[$w->item->id, '5', '100'], [$w->service->id, '1', '200']]);
        $d1 = SalesKit::deliver($w, $o1['id'], [$o1['lines'][0]['id'] => '3']);
        $inv1 = SalesKit::invoiceDelivery($w, $d1['id']);

        $return = SalesKit::post($user, $w->company, "sales-invoices/{$inv1['id']}/returns", ['lines' => [['invoice_line_id' => $inv1['lines'][0]['id'], 'quantity' => '1']]])
            ->assertCreated()->json('data');
        SalesKit::post($user, $w->company, "sales-returns/{$return['id']}/approve")->assertOk();
        SalesKit::post($user, $w->company, "sales-returns/{$return['id']}/receive")->assertOk();
        $credited = SalesKit::post($user, $w->company, "sales-returns/{$return['id']}/credit")->assertOk()->json('data');
        $crn = SalesKit::get($user, $w->company, "sales-invoices/{$credited['credit_invoice_id']}")->assertOk()->json('data');

        SalesKit::in($w->company, fn () => ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2027-06-14', 'forex_buying' => '30.5', 'forex_selling' => '30.5']));
        $inv2 = SalesKit::post($user, $w->company, 'sales-invoices', [
            'party_id' => $beta->id, 'document_date' => '2027-06-14', 'due_date' => '2027-07-20', 'currency_code' => 'USD',
            'lines' => [['item_id' => $w->service->id, 'quantity' => '2', 'unit_price' => '10']],
        ])->assertCreated()->json('data');
        $inv2 = SalesKit::post($user, $w->company, "sales-invoices/{$inv2['id']}/issue")->assertOk()->json('data');

        $inv3 = SalesKit::post($user, $w->company, 'sales-invoices', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-11',
            'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '50']],
        ])->assertCreated()->json('data');
        SalesKit::post($user, $w->company, "sales-invoices/{$inv3['id']}/issue")->assertOk();
        $inv3 = SalesKit::post($user, $w->company, "sales-invoices/{$inv3['id']}/reverse", ['reason' => 'Wrong price', 'date' => '2027-06-15'])->assertOk()->json('data');

        $wBeta = (object) [...(array) $w, 'party' => $beta];
        $o2 = SalesKit::confirmedOrder($wBeta, [[$w->item->id, '4', '80']]);
        $d2 = SalesKit::deliver($wBeta, $o2['id'], [$o2['lines'][0]['id'] => '2']);

        SalesKit::in($w->company, fn () => app(ReceivableSettlement::class)->apply($w->company, $inv1['id'], '100', 'PAY-1'));

        return (object) compact('w', 'beta', 'o1', 'o2', 'd1', 'd2', 'inv1', 'inv2', 'inv3', 'crn');
    }

    /**
     * @return TestResponse<Response>
     */
    public static function report(object $w, string $uri): TestResponse
    {
        return SalesKit::get($w->user, $w->company, 'sales-reports/'.$uri);
    }

    /**
     * Rows keyed by a column.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, array<string, mixed>>
     */
    public static function by(array $rows, string $column): array
    {
        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row[$column]] = $row;
        }

        return $out;
    }
}
