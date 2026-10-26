<?php

declare(strict_types=1);

namespace App\Modules\Parties\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Parties\Contracts\AssistantTools;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        return [new ErpTool($user, app(CompanyContext::class)->id(), 'party_search', 'Search parties by code or name. Returns at most 20 records without contact or tax identifiers.', ['parties.view'], 'read',
            fn (JsonSchema $schema): array => ['query' => $schema->string()->min(1)->max(100)->required()],
            function (Request $request): array {
                $data = $request->validate(['query' => ['required', 'string', 'min:1', 'max:100']]);

                return app(ReadService::class)->search((string) $data['query']);
            })];
    }
}
