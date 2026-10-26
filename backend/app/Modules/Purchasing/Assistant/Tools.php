<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Purchasing\Contracts\AssistantTools;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Services\SupplierAgeingReport;
use App\Modules\Purchasing\Reports\Support\Window;
use App\Modules\Purchasing\Services\RequestService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        $company = app(CompanyContext::class)->id();

        return [
            new ErpTool($user, $company, 'purchasing_outstanding', 'List open purchase orders and approved purchase requests. Select kind requests or orders; at most 20 records per page.', ['purchasing.requests.view', 'purchasing.orders.view'], 'read',
                fn (JsonSchema $s): array => ['kind' => $s->string()->enum(['requests', 'orders'])->required(), 'page' => $s->integer()->min(1)->max(1000)->required()],
                function (Request $r): array {
                    $d = $r->validate(['kind' => ['required', 'in:requests,orders'], 'page' => ['required', 'integer', 'min:1', 'max:1000']]);

                    return app(ReadService::class)->outstanding((string) $d['kind'], (int) $d['page']);
                }),
            new ErpTool($user, $company, 'supplier_ageing', 'Get supplier payable balances and ageing by currency as of a date, including posted settlements and reversals. Party ID required; at most 20 currency rows.', ['purchasing.reports.view', 'parties.view'], 'read',
                fn (JsonSchema $s): array => ['party_id' => $s->string()->required(), 'as_of' => $s->string()->required()],
                function (Request $r) use ($company): array {
                    $d = $r->validate(['party_id' => ['required', 'uuid'], 'as_of' => ['required', 'date_format:Y-m-d']]);
                    abort_if(app(PartyLookup::class)->find((string) $d['party_id']) === null, 404);
                    $table = app(SupplierAgeingReport::class)->build(new ReportFilters($company, asOf: (string) $d['as_of'], partyId: (string) $d['party_id']), 'supplier_currency', Window::page(1, 21));

                    return ['party_id' => $d['party_id'], 'as_of' => $d['as_of'], 'rows' => array_slice($table->rows, 0, 20), 'totals' => $table->meta, 'has_more' => count($table->rows) > 20];
                }),
            new ErpTool($user, $company, 'draft_purchase_request', 'Propose a purchase request draft for existing items. Requires human approval. Never submits or approves the request. No supplier order or payment is created.', ['purchasing.requests.create', 'items.view'], 'draft',
                fn (JsonSchema $s): array => ['document_date' => $s->string()->required(), 'needed_by' => $s->string()->required(), 'notes' => $s->string()->max(1000)->required(), 'lines' => $s->array()->min(1)->max(20)->items($s->object(['item_id' => $s->string()->required(), 'quantity' => $s->string()->required(), 'estimated_price' => $s->string()->required()])->withoutAdditionalProperties())->required()],
                function (Request $r) use ($user): array {
                    $d = $r->validate(['document_date' => ['required', 'date_format:Y-m-d'], 'needed_by' => ['required', 'date_format:Y-m-d', 'after_or_equal:document_date'], 'notes' => ['required', 'string', 'max:1000'], 'lines' => ['required', 'array', 'min:1', 'max:20'], 'lines.*' => ['array:item_id,quantity,estimated_price'], 'lines.*.item_id' => ['required', 'uuid'], 'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/'], 'lines.*.estimated_price' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/']]);
                    $lines = $d['lines'];
                    unset($d['lines']);
                    /** @var list<array<string, mixed>> $lines */
                    $document = app(RequestService::class)->create($d, $lines, $user);

                    return ['id' => $document->id, 'status' => $document->status->value, 'url' => '/purchasing/requests/'.$document->id];
                }),
        ];
    }
}
