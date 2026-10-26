<?php

declare(strict_types=1);

namespace App\Modules\Reference\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Reference\Contracts\AssistantTools;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Tools\Request;

final class Tools implements AssistantTools
{
    public function tools(User $user): array
    {
        $tools = [];
        $company = app(CompanyContext::class)->id();
        $definitions = [
            ['reference_warehouses', 'warehouses.view'],
            ['reference_cost_centers', 'cost_centers.view'],
            ['reference_projects', 'projects.view'],
            ['reference_payment_terms', 'payment_terms.view'],
        ];
        foreach ($definitions as [$name, $permission]) {
            $tools[] = new ErpTool($user, $company, $name, 'List active company reference records by optional code/name search. Returns 20 records per page.', [$permission], 'read',
                fn (JsonSchema $s): array => ['query' => $s->string()->max(100)->required(), 'page' => $s->integer()->min(1)->max(1000)->required()],
                function (Request $r) use ($name): array {
                    $d = $r->validate(['query' => ['present', 'string', 'max:100'], 'page' => ['required', 'integer', 'min:1', 'max:1000']]);

                    return app(ReadService::class)->lookup(str_replace('reference_', '', $name), (string) $d['query'], (int) $d['page']);
                });
        }
        $tools[] = new ErpTool($user, $company, 'reference_currencies', 'List active currencies enabled for the current company, at most 20 per page.', ['currencies.view'], 'read',
            fn (JsonSchema $s): array => ['page' => $s->integer()->min(1)->max(1000)->required()],
            function (Request $r): array {
                $d = $r->validate(['page' => ['required', 'integer', 'min:1', 'max:1000']]);

                return app(ReadService::class)->currencies((int) $d['page']);
            });

        return $tools;
    }
}
