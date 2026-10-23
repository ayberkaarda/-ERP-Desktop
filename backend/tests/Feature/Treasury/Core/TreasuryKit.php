<?php

declare(strict_types=1);

namespace Tests\Feature\Treasury\Core;

use App\Modules\Parties\Models\Party;
use Illuminate\Support\Facades\DB;
use Tests\Support\Purchasing\PurchKit;
use Tests\Support\Sales\SalesKit;

final class TreasuryKit
{
    public static function world(): object
    {
        $w = PurchKit::world();
        $permissions = array_keys(require base_path('app/Modules/Treasury/permissions.php'));
        $declaration = require base_path('app/Modules/Treasury/permissions.php');
        $w->user = PurchKit::user([...array_keys($declaration['permissions']), ...SalesKit::ALL]);
        $w->cash = self::account($w, 'CASH', 'cash', '100');
        $w->bank = self::account($w, 'BANK', 'bank', '102');

        return $w;
    }

    public static function gl(object $w, string $code): string
    {
        return (string) DB::table('accounts')->where('company_id', $w->company)->where('code', $code)->value('id');
    }

    public static function account(object $w, string $code, string $type, string $gl, string $currency = 'TRY', bool $negative = false): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-accounts', ['type' => $type, 'code' => $code, 'name' => $code, 'currency_code' => $currency, 'gl_account_id' => self::gl($w, $gl), 'allow_negative' => $negative])->assertCreated()->json('data');
    }

    public static function opening(object $w, array $account, string $amount = '1000', string $date = '2027-06-01', string $rate = '1'): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-accounts/'.$account['id'].'/opening-balance', ['version' => $account['version'], 'document_date' => $date, 'amount' => $amount, 'offset_account_id' => self::gl($w, '500'), 'reason' => 'Initial capital', 'fx_rate' => $rate])->assertOk()->json('data');
    }

    public static function payment(object $w, string $direction = 'payment', string $amount = '100', array $extra = []): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-payments', ['direction' => $direction, 'account_id' => $w->cash['id'], 'party_id' => $w->party->id, 'document_date' => '2027-06-12', 'amount' => $amount, 'fx_rate' => '1', ...$extra])->assertCreated()->json('data');
    }

    public static function post(object $w, array $payment): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-payments/'.$payment['id'].'/post', ['version' => $payment['version']])->assertOk()->json('data');
    }

    public static function invoice(object $w, string $price = '100', array $extra = []): array
    {
        $i = PurchKit::post($w->user, $w->company, 'purchase-invoices', ['party_id' => $w->party->id, 'document_date' => '2027-06-10', 'supplier_invoice_no' => 'INV-'.DB::table('purchase_invoices')->count(), 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => $price]], ...$extra])->assertCreated()->json('data');

        return PurchKit::post($w->user, $w->company, 'purchase-invoices/'.$i['id'].'/book')->assertOk()->json('data');
    }

    public static function sale(object $w): array
    {
        $party = PurchKit::in($w->company, fn () => Party::factory()->create(['roles' => ['customer']]));
        $i = PurchKit::post($w->user, $w->company, 'sales-invoices', ['party_id' => $party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100']]])->assertCreated()->json('data');

        return PurchKit::post($w->user, $w->company, 'sales-invoices/'.$i['id'].'/issue')->assertOk()->json('data');
    }
}
