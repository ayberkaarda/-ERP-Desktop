<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Tools;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Accounting\Contracts\AssistantTools as AccountingTools;
use App\Modules\Assistant\Contracts\AssistantToolProvider;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Catalog\Contracts\AssistantTools as CatalogTools;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Inventory\Contracts\AssistantTools as InventoryTools;
use App\Modules\Parties\Contracts\AssistantTools as PartiesTools;
use App\Modules\Purchasing\Contracts\AssistantTools as PurchasingTools;
use App\Modules\Reference\Contracts\AssistantTools as ReferenceTools;
use App\Modules\Sales\Contracts\AssistantTools as SalesTools;
use App\Modules\Treasury\Contracts\AssistantTools as TreasuryTools;
use Illuminate\Contracts\Container\Container;

final class ToolRegistry
{
    /** @var list<class-string<AssistantToolProvider>> */
    private const array PROVIDERS = [AccountingTools::class, CatalogTools::class, PartiesTools::class, InventoryTools::class, SalesTools::class, PurchasingTools::class, TreasuryTools::class, ReferenceTools::class];

    public function __construct(private readonly Container $container) {}

    /** @return list<ErpTool> */
    public function forUser(User $user): array
    {
        if (! config('assistant.enabled') || ! $this->container->make(CompanyContext::class)->has()) {
            return [];
        }
        $this->container->make(CompanyAuthorizer::class)->forget($user->id);
        $tools = [];
        foreach (self::PROVIDERS as $provider) {
            if (! $this->container->bound($provider)) {
                continue;
            }
            foreach ($this->container->make($provider)->tools($user) as $tool) {
                if ($tool->allowed(false)) {
                    $tools[] = $tool;
                }
            }
        }

        return $tools;
    }
}
