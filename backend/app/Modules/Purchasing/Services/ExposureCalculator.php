<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Core\Money\RoundingPolicy;
use App\Modules\Purchasing\Contracts\SupplierExposure;
use App\Modules\Purchasing\Data\SupplierExposureData;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * exposure = open payable balances (debit notes net them) + approved, not invoiced order value,
 * each valued at its document's rate in company currency. Remaining order value =
 * line_total * (quantity - invoiced) / quantity.
 */
final class ExposureCalculator implements SupplierExposure
{
    // Dependencies that read the active company are resolved per call (no retained context).

    public function exposure(string $companyId, string $partyId): SupplierExposureData
    {
        return app(CompanyContext::class)->runAs($companyId, function () use ($companyId, $partyId): SupplierExposureData {
            [$payables, $orders, $overdue] = $this->localParts($companyId, $partyId);

            return new SupplierExposureData($partyId, app(PurchasingSettings::class)->baseCurrency(), (string) $payables, (string) $orders,
                (string) $payables->plus($orders), (string) $overdue);
        });
    }

    /**
     * Open payables, open orders and overdue payables in company currency, scale 2.
     *
     * @return array{0: BigDecimal, 1: BigDecimal, 2: BigDecimal}
     */
    public function localParts(string $companyId, string $partyId): array
    {
        $payables = DB::table('purchase_invoices')->where('company_id', $companyId)->where('party_id', $partyId)
            ->whereIn('status', InvoiceStatus::open())
            ->selectRaw("coalesce(sum(round(balance_due * fx_rate, 2) * CASE WHEN invoice_type = 'return' THEN -1 ELSE 1 END), 0) AS amount,
                coalesce(sum(round(balance_due * fx_rate, 2)) FILTER (WHERE invoice_type = 'purchase' AND due_date < ?), 0) AS overdue", [now()->toDateString()])
            ->first();

        $orders = DB::table('purchase_order_lines as l')->join('purchase_orders as o', 'o.id', '=', 'l.document_id')
            ->where('o.company_id', $companyId)->where('o.party_id', $partyId)->whereIn('o.status', OrderStatus::openValues())
            ->selectRaw('coalesce(sum(round(l.line_total * greatest(l.quantity - l.invoiced_quantity, 0) / l.quantity * o.fx_rate, 2)), 0) AS amount')
            ->value('amount');

        return [
            RoundingPolicy::currency(is_numeric($payables?->amount) ? (string) $payables->amount : '0'),
            RoundingPolicy::currency(is_numeric($orders) ? (string) $orders : '0'),
            RoundingPolicy::currency(is_numeric($payables?->overdue) ? (string) $payables->overdue : '0'),
        ];
    }
}
