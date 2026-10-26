<?php

declare(strict_types=1);

namespace App\Modules\Sales\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Sales\Contracts\AssistantTools;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Services\CustomerAgeingReport;
use App\Modules\Sales\Reports\Services\SalesGroupReport;
use App\Modules\Sales\Services\QuoteService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        $company = app(CompanyContext::class)->id();

        return [
            new ErpTool($user, $company, 'sales_summary', 'Summarize invoiced sales and returns by customer over a range of at most 366 days. Shows at most 20 customers and totals.', ['sales.reports.view'], 'read',
                fn (JsonSchema $s): array => ['date_from' => $s->string()->required(), 'date_to' => $s->string()->required()],
                function (Request $r) use ($company): array {
                    $d = $r->validate(['date_from' => ['required', 'date_format:Y-m-d'], 'date_to' => ['required', 'date_format:Y-m-d', 'after_or_equal:date_from']]);
                    if (Carbon::parse((string) $d['date_from'])->diffInDays(Carbon::parse((string) $d['date_to'])) > 366) {
                        throw ValidationException::withMessages(['date_to' => 'The range must not exceed 366 days.']);
                    }
                    $service = app(SalesGroupReport::class);
                    $table = $service->build(new ReportFilters($company, dateFrom: (string) $d['date_from'], dateTo: (string) $d['date_to']), 'customer');

                    return ['date_from' => $d['date_from'], 'date_to' => $d['date_to'], 'rows' => $service->decorate(array_slice($table->rows, 0, 20), 'customer'), 'totals' => $table->meta, 'has_more' => count($table->rows) > 20];
                }),
            new ErpTool($user, $company, 'sales_overdue_orders', 'List open customer orders whose requested delivery date is before as_of. Returns 20 per page.', ['sales.orders.view'], 'read',
                fn (JsonSchema $s): array => ['as_of' => $s->string()->required(), 'page' => $s->integer()->min(1)->max(1000)->required()],
                function (Request $r): array {
                    $d = $r->validate(['as_of' => ['required', 'date_format:Y-m-d'], 'page' => ['required', 'integer', 'min:1', 'max:1000']]);

                    return app(ReadService::class)->overdueOrders((string) $d['as_of'], (int) $d['page']);
                }),
            new ErpTool($user, $company, 'customer_ageing', 'Get customer receivable balances and ageing by currency as of a date, including posted settlements and reversals. Party ID is required. At most 20 currency rows.', ['sales.reports.view', 'parties.view'], 'read',
                fn (JsonSchema $s): array => ['party_id' => $s->string()->required(), 'as_of' => $s->string()->required()],
                function (Request $r) use ($company): array {
                    $d = $r->validate(['party_id' => ['required', 'uuid'], 'as_of' => ['required', 'date_format:Y-m-d']]);
                    abort_if(app(PartyLookup::class)->find((string) $d['party_id']) === null, 404);
                    $table = app(CustomerAgeingReport::class)->build(new ReportFilters($company, asOf: (string) $d['as_of'], partyId: (string) $d['party_id']), 'customer_currency');

                    return ['party_id' => $d['party_id'], 'as_of' => $d['as_of'], 'rows' => array_slice($table->rows, 0, 20), 'totals' => $table->meta, 'has_more' => count($table->rows) > 20];
                }),
            new ErpTool($user, $company, 'draft_sales_quote', 'Propose a sales quote draft for an existing customer and items. Human approval required; never sends or accepts the quote. Uses default prices unless an explicit unit_price is provided; existing price overrides remain forbidden.', ['sales.quotes.create', 'parties.view', 'items.view'], 'draft',
                fn (JsonSchema $s): array => ['party_id' => $s->string()->required(), 'document_date' => $s->string()->required(), 'notes' => $s->string()->max(1000)->required(), 'lines' => $s->array()->min(1)->max(20)->items($s->object(['item_id' => $s->string()->required(), 'quantity' => $s->string()->required(), 'unit_price' => $s->string()])->withoutAdditionalProperties())->required()],
                function (Request $r) use ($user): array {
                    $d = $r->validate(['party_id' => ['required', 'uuid'], 'document_date' => ['required', 'date_format:Y-m-d'], 'notes' => ['required', 'string', 'max:1000'], 'lines' => ['required', 'array', 'min:1', 'max:20'], 'lines.*' => ['array:item_id,quantity,unit_price'], 'lines.*.item_id' => ['required', 'uuid'], 'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/'], 'lines.*.unit_price' => ['sometimes', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/']]);
                    $lines = $d['lines'];
                    unset($d['lines']);
                    /** @var list<array<string, mixed>> $lines */
                    $quote = app(QuoteService::class)->create($d, $lines, $user, false);

                    return ['id' => $quote->id, 'status' => $quote->status->value, 'url' => '/sales/quotes/'.$quote->id];
                }),
        ];
    }
}
