<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Enums\DiscountScope;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemCategory;
use Illuminate\Support\Facades\DB;

final class DiscountRuleService
{
    public const array INDEXES = ['discount_rules_company_code_unique' => 'code'];

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): DiscountRule
    {
        return CatalogRules::transaction(function () use ($data): DiscountRule {
            $rule = new DiscountRule($data);
            $this->lockScope($rule);
            $rule->save();

            return $rule;
        }, self::INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(DiscountRule $rule, array $data, int $version): DiscountRule
    {
        return CatalogRules::transaction(function () use ($rule, $data, $version): DiscountRule {
            $rule = CatalogRules::lockVersion($rule, $version);
            $rule->fill($data);
            $this->lockScope($rule);
            $rule->save();

            return $rule;
        }, self::INDEXES);
    }

    public function delete(DiscountRule $rule, ?int $version = null): void
    {
        DB::transaction(fn () => CatalogRules::lockVersion($rule, $version)->delete());
    }

    /**
     * The referenced item or category stays FOR SHARE locked until commit; their deletes lock the
     * row FOR UPDATE and then check usage, so a rule never points at a deleted record.
     */
    private function lockScope(DiscountRule $rule): void
    {
        $class = match ($rule->scope) {
            DiscountScope::Item => Item::class,
            DiscountScope::Category => ItemCategory::class,
            default => null,
        };

        if ($class !== null && ! CatalogRules::sharedExists($class, [$rule->scope_ref])) {
            CatalogRules::fail('scope_ref', 'scope_ref_missing');
        }
    }
}
