<?php

declare(strict_types=1);

namespace Tests\Feature\Treasury\Banking;

use App\Modules\Organization\Models\Company;
use App\Modules\Parties\Models\Party;
use Tests\Support\Accounting\Books;
use Tests\Support\Identity;
use Tests\Support\Purchasing\PurchKit;
use Tests\Support\Sales\SalesKit;

final class ExtensionKit
{
    public static function world(bool $fullChart = false): object
    {
        PurchKit::boot();
        config(['accounting.chart_path' => $fullChart ? base_path('app/Modules/Accounting/Database/data/tdhp.json') : __DIR__.'/chart.json']);
        $company = PurchKit::company();
        $party = PurchKit::supplier($company);
        $customer = PurchKit::in($company, fn () => Party::factory()->create());
        $user = Identity::member(Company::query()->findOrFail($company));

        return (object) compact('company', 'party', 'customer', 'user');
    }

    public static function bank(object $w, string $code = 'BANK', string $currency = 'TRY'): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-accounts', [
            'type' => 'bank', 'code' => $code, 'name' => 'Bank account', 'currency_code' => $currency, 'gl_account_id' => Books::account($w->company, '102')->id,
            'iban' => 'TR330006100519786457841326', 'is_active' => true, 'allow_negative' => false,
        ])->assertCreated()->json('data');
    }

    public static function receipt(object $w, array $bank, string $amount = '100'): array
    {
        $payment = PurchKit::post($w->user, $w->company, 'treasury-payments', [
            'direction' => 'receipt', 'account_id' => $bank['id'], 'party_id' => $w->customer->id,
            'document_date' => '2027-06-15', 'amount' => $amount, 'currency_code' => 'TRY', 'fx_rate' => '1', 'allocations' => [],
        ])->assertCreated()->json('data');

        return PurchKit::post($w->user, $w->company, "treasury-payments/{$payment['id']}/post", ['version' => $payment['version']])->assertOk()->json('data');
    }

    public static function statement(object $w, array $bank, string $amount = '100'): array
    {
        return PurchKit::post($w->user, $w->company, 'treasury-bank-statements', [
            'account_id' => $bank['id'], 'format' => 'csv', 'content' => "date,amount,reference\n2027-06-15,{$amount},BANK-1",
            'currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => $amount,
        ])->assertCreated()->json('data');
    }

    public static function invoice(object $w, string $module, string $amount = '100', string $currency = 'TRY', string $fxRate = '1', string $taxRate = '20'): array
    {
        $unit = SalesKit::unit($w->company);
        $tax = PurchKit::taxCode($w->company, $taxRate);
        $service = SalesKit::item($w->company, ['type' => 'service', 'default_tax_code_id' => $tax->id], $unit);
        $base = $module === 'sales' ? 'sales-invoices' : 'purchase-invoices';
        $invoice = PurchKit::post($w->user, $w->company, $base, [
            'party_id' => $module === 'sales' ? $w->customer->id : $w->party->id, 'document_date' => '2027-06-10',
            'currency_code' => $currency, 'fx_rate' => $fxRate,
            'supplier_invoice_no' => $module === 'purchasing' ? 'SUPPLIER-1' : null,
            'lines' => [['item_id' => $service->id, 'quantity' => '1', 'unit_price' => $amount]],
        ])->assertCreated()->json('data');

        return PurchKit::post($w->user, $w->company, $base.'/'.$invoice['id'].($module === 'sales' ? '/issue' : '/book'))->assertOk()->json('data');
    }
}
