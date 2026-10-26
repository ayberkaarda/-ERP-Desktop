<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\EDocuments\Contracts\AssistantTools;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        return [new ErpTool($user, app(CompanyContext::class)->id(), 'e_document_status', 'List at most 20 sandbox electronic document statuses by direction and optional number or party search. This tool never sends, validates or responds to electronic documents.', ['edocuments.view'], 'read',
            fn (JsonSchema $s): array => ['direction' => $s->string()->enum(['incoming', 'outgoing'])->required(), 'query' => $s->string()->max(100)->required()],
            function (Request $request) use ($user): array {
                $data = $request->validate(['direction' => ['required', 'in:incoming,outgoing'], 'query' => ['present', 'string', 'max:100']]);

                return app(ReadService::class)->list($user, (string) $data['direction'], (string) $data['query']);
            })];
    }
}
