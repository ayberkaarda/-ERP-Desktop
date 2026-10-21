<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Sales\Contracts\CustomerExposure;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Services\CreditControl;
use App\Modules\Sales\Services\DocumentLinks;
use App\Modules\Sales\Services\ExposureCalculator;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Customer views for the party screen: GET /customers/{id}/exposure and /customers/{id}/sales-summary
 * (any of sales.quotes.view, sales.orders.view, sales.invoices.view). Amounts in company currency
 * unless stated (exposure is in the party's risk currency).
 */
final class CustomerController
{
    public const array PERMISSIONS = ['sales.quotes.view', 'sales.orders.view', 'sales.invoices.view'];

    public function __construct(
        private readonly PartyLookup $parties,
        private readonly CompanyContext $company,
    ) {}

    /**
     * `?document_id=` (an order or sale invoice of this customer the caller may view) adds
     * document_amount: what that document adds to the exposure at confirmation / issue, in the risk
     * currency (its total less the open order value it replaces). Null without document_id.
     */
    public function exposure(Request $request, string $id, CustomerExposure $exposure, CreditControl $credit, InvoiceService $invoices): JsonResponse
    {
        Gate::authorize('sales-customer-view');
        $party = $this->party($id);
        $data = $exposure->exposure($this->company->id(), $party)->toArray();
        $data['document_amount'] = null;
        $documentId = $request->query('document_id');

        if ($documentId !== null) {
            $document = $this->exposureDocument($documentId, $party);
            Gate::authorize('view', $document);
            $covered = $document instanceof SalesInvoice ? $invoices->coveredLocal($document) : '0';
            $data['document_amount'] = $credit->documentAmount((string) $data['currency'], (string) $document->total_local, $covered);
        }

        return ApiResponse::success($data);
    }

    public function summary(string $id, ExposureCalculator $exposure): JsonResponse
    {
        Gate::authorize('sales-customer-view');
        $party = $this->party($id);
        $company = $this->company->id();
        $invoices = DB::table('sales_invoices')->where('company_id', $company)->where('party_id', $party)
            ->whereIn('status', InvoiceStatus::booked())
            ->selectRaw("count(*) FILTER (WHERE invoice_type = 'sale') AS invoice_count,
                coalesce(sum(total_local) FILTER (WHERE invoice_type = 'sale'), 0) AS invoiced_total,
                coalesce(sum(total_local) FILTER (WHERE invoice_type = 'return'), 0) AS credited_total,
                coalesce(sum(round(balance_due * fx_rate, 2) * CASE WHEN invoice_type = 'return' THEN -1 ELSE 1 END), 0) AS balance_due,
                max(document_date) FILTER (WHERE invoice_type = 'sale') AS last_invoice_date")
            ->first();
        $quotes = DB::table('sales_quotes')->where('company_id', $company)->where('party_id', $party)->whereIn('status', ['draft', 'sent', 'accepted'])
            ->selectRaw('count(*) AS open_count, coalesce(sum(total_local), 0) AS open_total')->first();
        [, $openOrders] = $exposure->localParts($company, $party);
        $orderCount = DB::table('sales_orders')->where('company_id', $company)->where('party_id', $party)->whereIn('status', OrderStatus::openValues())->count();

        return ApiResponse::success([
            'party_id' => $party,
            'currency' => app(SalesSettings::class)->baseCurrency(),
            'exposure' => $exposure->exposure($company, $party)->toArray(),
            'quotes' => ['open_count' => (int) ($quotes->open_count ?? 0), 'open_total' => self::money($quotes->open_total ?? '0')],
            'orders' => ['open_count' => $orderCount, 'open_value' => (string) $openOrders],
            'invoices' => [
                'count' => (int) ($invoices->invoice_count ?? 0),
                'invoiced_total' => self::money($invoices->invoiced_total ?? '0'),
                'credited_total' => self::money($invoices->credited_total ?? '0'),
                'balance_due' => self::money($invoices->balance_due ?? '0'),
                'last_invoice_date' => $invoices->last_invoice_date ?? null,
            ],
            'recent_orders' => SalesOrder::query()->where('party_id', $party)->orderByDesc('document_date')->orderByDesc('id')->limit(5)->get()
                ->map(static fn (SalesOrder $o): array => DocumentLinks::link($o))->values()->all(),
            'recent_invoices' => SalesInvoice::query()->where('party_id', $party)->orderByDesc('document_date')->orderByDesc('id')->limit(5)->get()
                ->map(static fn (SalesInvoice $i): array => [...DocumentLinks::link($i), 'balance_due' => (string) $i->balance_due])->values()->all(),
        ]);
    }

    private function exposureDocument(mixed $id, string $party): SalesOrder|SalesInvoice
    {
        $document = null;

        if (is_string($id) && Str::isUuid($id)) {
            $document = SalesOrder::query()->whereKey($id)->where('party_id', $party)->first()
                ?? SalesInvoice::query()->whereKey($id)->where('party_id', $party)->where('invoice_type', 'sale')->first();
        }

        return $document ?? Messages::fail('document_id', 'exposure_document_unknown');
    }

    private function party(string $id): string
    {
        if (! Str::isUuid($id) || $this->parties->find($id) === null) {
            abort(404);
        }

        return $id;
    }

    private static function money(mixed $value): string
    {
        return (string) BigDecimal::of(is_numeric($value) ? (string) $value : '0')->toScale(2, RoundingMode::HalfUp);
    }
}
