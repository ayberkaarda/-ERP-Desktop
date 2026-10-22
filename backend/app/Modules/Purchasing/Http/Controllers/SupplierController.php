<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Purchasing\Contracts\SupplierExposure;
use App\Modules\Purchasing\Contracts\SupplierPerformance;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Services\DocumentLinks;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Supplier views for the party screen (any of purchasing.orders.view, purchasing.invoices.view):
 * GET /suppliers/{id}/exposure, /purchase-summary and /performance (?from=&to=, default the last
 * twelve months). Amounts in company currency, scale 2.
 */
final class SupplierController
{
    public const array PERMISSIONS = ['purchasing.orders.view', 'purchasing.invoices.view'];

    // No constructor dependencies: the router keeps one controller instance across requests.

    public function exposure(string $id, SupplierExposure $exposure): JsonResponse
    {
        Gate::authorize('purchasing-supplier-view');

        return ApiResponse::success($exposure->exposure(app(CompanyContext::class)->id(), $this->party($id))->toArray());
    }

    public function summary(string $id, SupplierExposure $exposure): JsonResponse
    {
        Gate::authorize('purchasing-supplier-view');
        $party = $this->party($id);
        $company = app(CompanyContext::class)->id();
        $invoices = DB::table('purchase_invoices')->where('company_id', $company)->where('party_id', $party)
            ->whereIn('status', InvoiceStatus::booked())
            ->selectRaw("count(*) FILTER (WHERE invoice_type = 'purchase') AS invoice_count,
                coalesce(sum(total_local) FILTER (WHERE invoice_type = 'purchase'), 0) AS invoiced_total,
                coalesce(sum(total_local) FILTER (WHERE invoice_type = 'return'), 0) AS debited_total,
                coalesce(sum(round(balance_due * fx_rate, 2) * CASE WHEN invoice_type = 'return' THEN -1 ELSE 1 END), 0) AS balance_due,
                max(document_date) FILTER (WHERE invoice_type = 'purchase') AS last_invoice_date")
            ->first();
        $orderCount = DB::table('purchase_orders')->where('company_id', $company)->where('party_id', $party)->whereIn('status', OrderStatus::openValues())->count();
        $data = $exposure->exposure($company, $party);

        return ApiResponse::success([
            'party_id' => $party,
            'currency' => app(PurchasingSettings::class)->baseCurrency(),
            'exposure' => $data->toArray(),
            'orders' => ['open_count' => $orderCount, 'open_value' => $data->openOrders],
            'invoices' => [
                'count' => (int) ($invoices->invoice_count ?? 0),
                'invoiced_total' => self::money($invoices->invoiced_total ?? '0'),
                'debited_total' => self::money($invoices->debited_total ?? '0'),
                'balance_due' => self::money($invoices->balance_due ?? '0'),
                'last_invoice_date' => $invoices->last_invoice_date ?? null,
            ],
            'recent_orders' => PurchaseOrder::query()->where('party_id', $party)->orderByDesc('document_date')->orderByDesc('id')->limit(5)->get()
                ->map(static fn (PurchaseOrder $o): array => DocumentLinks::link($o))->values()->all(),
            'recent_invoices' => PurchaseInvoice::query()->where('party_id', $party)->orderByDesc('document_date')->orderByDesc('id')->limit(5)->get()
                ->map(static fn (PurchaseInvoice $i): array => [...DocumentLinks::link($i), 'balance_due' => (string) $i->balance_due])->values()->all(),
        ]);
    }

    public function performance(Request $request, string $id, SupplierPerformance $performance): JsonResponse
    {
        Gate::authorize('purchasing-supplier-view');
        $party = $this->party($id);
        $valid = Validator::make($request->query(), [
            'from' => ['sometimes', 'date_format:Y-m-d'], 'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ])->validate();
        $to = is_string($valid['to'] ?? null) ? $valid['to'] : now()->toDateString();
        $from = is_string($valid['from'] ?? null) ? $valid['from'] : (new DateTimeImmutable($to))->modify('-1 year')->format('Y-m-d');

        return ApiResponse::success($performance->forParty(app(CompanyContext::class)->id(), $party, new DateTimeImmutable($from), new DateTimeImmutable($to))->toArray());
    }

    private function party(string $id): string
    {
        if (! Str::isUuid($id) || app(PartyLookup::class)->find($id) === null) {
            abort(404);
        }

        return $id;
    }

    private static function money(mixed $value): string
    {
        return (string) BigDecimal::of(is_numeric($value) ? (string) $value : '0')->toScale(2, RoundingMode::HalfUp);
    }
}
