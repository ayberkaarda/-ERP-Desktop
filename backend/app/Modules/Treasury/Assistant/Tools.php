<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Treasury\Contracts\AssistantTools;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        return [new ErpTool($user, app(CompanyContext::class)->id(), 'treasury_balances', 'List active company cash, bank and POS account balances as of a date. At most 20 accounts per page; currencies are separate.', ['treasury.accounts.view'], 'read',
            fn (JsonSchema $schema): array => ['as_of' => $schema->string()->required(), 'page' => $schema->integer()->min(1)->max(1000)->required()],
            function (Request $request): array {
                $data = $request->validate(['as_of' => ['required', 'date_format:Y-m-d'], 'page' => ['required', 'integer', 'min:1', 'max:1000']]);

                return app(ReadService::class)->balances((string) $data['as_of'], (int) $data['page']);
            })];
    }
}
