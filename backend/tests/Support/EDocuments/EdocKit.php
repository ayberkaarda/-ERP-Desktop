<?php

declare(strict_types=1);

namespace Tests\Support\EDocuments;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Models\Company;
use App\Modules\Sales\Services\DeliveryService;
use App\Modules\Sales\Services\InvoiceService;
use Illuminate\Support\Carbon;
use Tests\Support\Identity;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

final class EdocKit
{
    /** Real issued/posted current-year business documents; safe to use from isolated smoke bootstrap. */
    public static function world(): object
    {
        SalesKit::boot();
        $day = gmdate('Y-m-d');
        Carbon::setTestNow($day.' 10:00:00');
        $company = SalesKit::company();
        $model = Company::query()->findOrFail($company);
        $model->update(['name' => 'Keystone Demo', 'legal_name' => 'Keystone Demo Ticaret A.Ş.', 'tax_number' => '1234567890', 'tax_office' => 'Kadıköy', 'address' => 'Demo Caddesi 10']);
        $warehouse = SalesKit::warehouse($company);
        $unit = SalesKit::unit($company);
        $tax = SalesKit::taxCode($company);
        $item = SalesKit::item($company, ['code' => 'DEMO-01', 'name' => 'Demo Ürün', 'default_tax_code_id' => $tax->id], $unit);
        $service = SalesKit::item($company, ['code' => 'DEMO-SVC', 'name' => 'Demo Hizmet', 'type' => 'service', 'default_tax_code_id' => $tax->id], $unit);
        $party = SalesKit::party($company, ['name' => 'Örnek Müşteri', 'legal_name' => 'Örnek Müşteri Ticaret A.Ş.', 'tax_number' => '9876543210', 'tax_office' => 'Beşiktaş']);
        $user = Identity::member($model, ['Admin']);
        $metadata = ['supplier_address' => ['street' => 'Demo Caddesi 10', 'city' => 'İstanbul', 'district' => 'Kadıköy', 'postal_code' => '34710', 'country_code' => 'TR'], 'customer_address' => ['street' => 'Örnek Sokak 20', 'city' => 'İstanbul', 'district' => 'Beşiktaş', 'postal_code' => '34340', 'country_code' => 'TR'], 'actual_despatch_date' => $day, 'actual_despatch_time' => '09:00:00', 'vehicle_plate' => '34ABC123', 'driver_first_name' => 'Demo', 'driver_last_name' => 'Sürücü', 'driver_tax_number' => '10000000146', 'unit_codes' => [$unit->code => 'C62']];
        $world = app(CompanyContext::class)->runAs($company, function () use ($company, $warehouse, $service, $item, $party, $user, $day, $metadata): array {
            $billing = ['line1' => 'Örnek Sokak 20', 'city' => 'İstanbul', 'district' => 'Beşiktaş', 'postal_code' => '34340', 'country' => 'TR'];
            $invoiceService = app(InvoiceService::class);
            $invoice = $invoiceService->create(['party_id' => $party->id, 'document_date' => $day, 'billing_address' => $billing], [['item_id' => $service->id, 'quantity' => '2', 'unit_price' => '100']], $user, false);
            [$invoice] = $invoiceService->issue($invoice, $invoice->version, null, false, $user);
            Inv::receive($company, $warehouse->id, $item->id, '10', '50', [], $day);
            SalesKit::setting($company, 'sales.allow_direct_delivery', true);
            $deliveries = app(DeliveryService::class);
            $delivery = $deliveries->createDirect(['party_id' => $party->id, 'document_date' => $day, 'warehouse_id' => $warehouse->id, 'billing_address' => $billing], [['item_id' => $item->id, 'quantity' => '2', 'unit_price' => '100']], $user, false);
            [$delivery] = $deliveries->post($delivery, $delivery->version, $user);

            return compact('invoice', 'delivery');
        });

        return (object) ['company' => $company, 'companyModel' => $model, 'user' => $user, 'party' => $party, 'unit' => $unit, 'item' => $item, 'service' => $service, 'warehouse' => $warehouse, 'invoice' => $world['invoice'], 'delivery' => $world['delivery'], 'metadata' => $metadata, 'day' => $day];
    }
}
