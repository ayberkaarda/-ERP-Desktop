<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Inventory\Contracts\AssistantTools;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        $company = app(CompanyContext::class)->id();

        return [new ErpTool($user, $company, 'stock_availability', 'Get item quantity available in an active company warehouse, excluding reservations.', ['inventory.stock.view'], 'read',
            fn (JsonSchema $schema): array => ['item_id' => $schema->string()->required(), 'warehouse_id' => $schema->string()->required()],
            function (Request $request) use ($company): array {
                $data = $request->validate(['item_id' => ['required', 'uuid'], 'warehouse_id' => ['required', 'uuid']]);

                return app(ReadService::class)->availability($company, (string) $data['item_id'], (string) $data['warehouse_id']);
            })];
    }
}
