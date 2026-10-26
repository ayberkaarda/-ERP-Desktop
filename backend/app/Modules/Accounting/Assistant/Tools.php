<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Accounting\Contracts\AssistantTools;
use App\Modules\Accounting\Services\JournalDrafts;
use App\Modules\Assistant\Contracts\ErpTool;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        $company = app(CompanyContext::class)->id();

        return [
            new ErpTool($user, $company, 'account_search', 'Find active ledger accounts by code or name, returning at most 20. Indicates required party and dimension fields.', ['accounting.accounts.view'], 'read',
                fn (JsonSchema $s): array => ['query' => $s->string()->min(1)->max(100)->required()],
                function (Request $r): array {
                    $d = $r->validate(['query' => ['required', 'string', 'min:1', 'max:100']]);

                    return app(ReadService::class)->search((string) $d['query']);
                }),
            new ErpTool($user, $company, 'account_balance', 'Get a ledger account balance by exact account code, including debit and credit totals at the specified date.', ['accounting.accounts.view'], 'read',
                fn (JsonSchema $s): array => ['account_code' => $s->string()->max(32)->required(), 'as_of' => $s->string()->required()],
                function (Request $r): array {
                    $d = $r->validate(['account_code' => ['required', 'string', 'max:32'], 'as_of' => ['required', 'date_format:Y-m-d']]);

                    return app(ReadService::class)->balance((string) $d['account_code'], (string) $d['as_of']);
                }),
            new ErpTool($user, $company, 'draft_journal_entry', 'Propose a general journal draft. Human approval required. Never posts the journal. Amounts are decimal strings; at most 20 lines.', ['accounting.entries.create'], 'draft',
                fn (JsonSchema $s): array => ['entry_date' => $s->string()->required(), 'description' => $s->string()->max(1000)->required(), 'lines' => $s->array()->min(1)->max(20)->items($s->object(['account_code' => $s->string()->max(32)->required(), 'debit' => $s->string()->required(), 'credit' => $s->string()->required(), 'description' => $s->string()->max(500), 'party_id' => $s->string(), 'cost_center_id' => $s->string(), 'project_id' => $s->string()])->withoutAdditionalProperties())->required()],
                function (Request $r) use ($user): array {
                    $d = $r->validate(['entry_date' => ['required', 'date_format:Y-m-d'], 'description' => ['required', 'string', 'max:1000'], 'lines' => ['required', 'array', 'min:1', 'max:20'], 'lines.*' => ['array:account_code,debit,credit,description,party_id,cost_center_id,project_id'], 'lines.*.account_code' => ['required', 'string', 'max:32'], 'lines.*.debit' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,4})?$/'], 'lines.*.credit' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,4})?$/'], 'lines.*.description' => ['sometimes', 'string', 'max:500'], 'lines.*.party_id' => ['sometimes', 'uuid'], 'lines.*.cost_center_id' => ['sometimes', 'uuid'], 'lines.*.project_id' => ['sometimes', 'uuid']]);
                    $entry = app(JournalDrafts::class)->create(['entry_type' => 'general', ...$d], $user->id);

                    return ['id' => $entry->id, 'status' => $entry->status->value, 'url' => '/accounting/journal-entries/'.$entry->id];
                }),
        ];
    }
}
