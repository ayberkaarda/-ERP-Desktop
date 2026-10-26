<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Data\ResolvedPrice;
use App\Modules\Catalog\Enums\DiscountScope;
use App\Modules\Catalog\Enums\PriceSource;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use Brick\Math\BigDecimal;
use Brick\Math\BigRational;
use Brick\Math\Exception\MathException;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * See the PriceResolver contract for the precedence rules; every tie ends on the row id, so the
 * same data always yields the same answer.
 */
final class DatabasePriceResolver implements PriceResolver
{
    public function __construct(private readonly ReferenceGuards $guards) {}

    public function resolve(
        string $itemId,
        ?string $variantId,
        ?string $partyId,
        string $qty,
        string $unitId,
        DateTimeInterface $date,
        string $currency,
    ): ResolvedPrice {
        $quantity = $this->quantity($qty);
        $item = Str::isUuid($itemId) ? Item::query()->find($itemId) : null;

        if (! $item instanceof Item) {
            CatalogRules::fail('item_id', 'item_missing');
        }

        if ($variantId !== null && (! Str::isUuid($variantId)
            || ! ItemVariant::query()->whereKey($variantId)->where('item_id', $item->id)->exists())) {
            CatalogRules::fail('variant_id', 'variant_mismatch');
        }

        $converter = new UnitConverter;
        $baseQty = $converter->convertExact($quantity, $unitId, $item->base_unit_id, $item->id);
        $day = $date->format('Y-m-d');
        $currency = strtoupper($currency);

        $price = null;

        foreach ($this->lists($partyId, $currency, $day) as [$list, $source]) {
            $line = $this->bestLine($list, $item, $variantId, $quantity, $unitId, $day, $converter);

            if ($line !== null) {
                $price = [$list, $source, ...$line];

                break;
            }
        }

        [$rules, $remaining] = $this->discounts($item, $partyId, $baseQty, $day);
        $percent = BigRational::of(1)->minus($remaining)->multipliedBy(100)->toScale(4, RoundingPolicy::MODE);

        if ($price === null) {
            return new ResolvedPrice(null, null, $currency, null, null, null, null, (string) $percent, $rules, PriceSource::None);
        }

        /** @var PriceList $list */
        [$list, $source, $line, $unitPrice] = $price;

        return new ResolvedPrice(
            (string) $unitPrice->toScale(RoundingPolicy::DECIMAL_SCALE, RoundingPolicy::MODE),
            (string) $unitPrice->multipliedBy($remaining)->toScale(RoundingPolicy::DECIMAL_SCALE, RoundingPolicy::MODE),
            $currency,
            $list->id,
            $line->id,
            $line->unit_id,
            $list->tax_inclusive,
            (string) $percent,
            $rules,
            $source,
        );
    }

    /**
     * @return list<array{0: PriceList, 1: PriceSource}>
     */
    private function lists(?string $partyId, string $currency, string $day): array
    {
        $lists = [];
        $partyList = $partyId === null ? null : $this->guards->partyPriceListId($partyId);

        if ($partyList !== null && Str::isUuid($partyList)) {
            $list = $this->usable(PriceList::query()->whereKey($partyList), $currency, $day)->first();

            if ($list instanceof PriceList) {
                $lists[] = [$list, PriceSource::PartyPriceList];
            }
        }

        $default = $this->usable(PriceList::query()->where('is_default', true), $currency, $day)->orderBy('id')->first();

        if ($default instanceof PriceList && ($lists === [] || $lists[0][0]->id !== $default->id)) {
            $lists[] = [$default, PriceSource::DefaultPriceList];
        }

        return $lists;
    }

    /**
     * @param  Builder<PriceList>  $query
     * @return Builder<PriceList>
     */
    private function usable(Builder $query, string $currency, string $day): Builder
    {
        return $this->validOn($query->where('is_active', true)->where('currency_code', $currency), $day);
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    private function validOn(Builder $query, string $day): Builder
    {
        return $query
            ->where(fn (Builder $q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', $day))
            ->where(fn (Builder $q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $day));
    }

    /**
     * @return array{0: PriceListLine, 1: BigRational}|null line and its price per requested unit
     */
    private function bestLine(PriceList $list, Item $item, ?string $variantId, BigDecimal $qty, string $unitId, string $day, UnitConverter $converter): ?array
    {
        $query = PriceListLine::query()
            ->where('price_list_id', $list->id)
            ->where('item_id', $item->id)
            ->where(fn (Builder $q) => $variantId === null
                ? $q->whereNull('variant_id')
                : $q->whereNull('variant_id')->orWhere('variant_id', $variantId));

        $candidates = [];

        foreach ($this->validOn($query, $day)->get() as $line) {
            // Requested unit -> line unit; lines in units that cannot be converted are ignored.
            $factor = $converter->tryFactor($unitId, $line->unit_id, $item->id);
            $toBase = $converter->tryFactor($line->unit_id, $item->base_unit_id, $item->id);

            if ($factor === null || $toBase === null || $line->min_qty->isGreaterThan($qty->toBigRational()->multipliedBy($factor))) {
                continue;
            }

            $candidates[] = [
                'line' => $line,
                'price' => $line->price->toBigRational()->multipliedBy($factor),
                'variant' => $line->variant_id !== null ? 1 : 0,
                'min_base' => $line->min_qty->toBigRational()->multipliedBy($toBase),
                'exact_unit' => $line->unit_id === $unitId ? 1 : 0,
                'valid_from' => $line->valid_from?->toDateString() ?? '',
            ];
        }

        usort($candidates, static function (array $a, array $b): int {
            return ($b['variant'] <=> $a['variant'])
                ?: $b['min_base']->compareTo($a['min_base'])
                ?: ($b['exact_unit'] <=> $a['exact_unit'])
                ?: strcmp($b['valid_from'], $a['valid_from'])
                ?: strcmp($a['line']->id, $b['line']->id);
        });

        if ($candidates === []) {
            return null;
        }

        return [$candidates[0]['line'], $candidates[0]['price']];
    }

    /**
     * @return array{0: list<string>, 1: BigRational} applied rule ids and the remaining price share
     */
    private function discounts(Item $item, ?string $partyId, BigRational $baseQty, string $day): array
    {
        $ancestors = [];

        if ($item->category_id !== null) {
            $path = $item->category()->value('path');
            $ancestors = is_string($path) ? array_values(array_filter(explode('/', $path))) : [];
        }

        $query = DiscountRule::query()
            ->where('is_active', true)
            ->where(fn (Builder $q) => $partyId === null ? $q->whereNull('party_id') : $q->whereNull('party_id')->orWhere('party_id', $partyId))
            ->where(function (Builder $q) use ($item, $ancestors, $partyId): void {
                $q->where('scope', DiscountScope::All->value)
                    ->orWhere(fn (Builder $w) => $w->where('scope', DiscountScope::Item->value)->where('scope_ref', $item->id));

                if ($ancestors !== []) {
                    $q->orWhere(fn (Builder $w) => $w->where('scope', DiscountScope::Category->value)->whereIn('scope_ref', $ancestors));
                }

                if ($partyId !== null) {
                    $q->orWhere(fn (Builder $w) => $w->where('scope', DiscountScope::Party->value)->where('party_id', $partyId));
                }
            });

        $rules = [];

        foreach ($this->validOn($query, $day)->get() as $rule) {
            if ($rule->min_qty->toBigRational()->isGreaterThan($baseQty)) {
                continue;
            }

            // Deeper categories are more specific than their ancestors.
            $depth = $rule->scope === DiscountScope::Category ? (int) array_search($rule->scope_ref, $ancestors, true) + 1 : 0;

            $rules[] = [
                'rule' => $rule,
                'key' => [-$rule->priority, -($rule->scope->specificity() * 100 + $depth), $rule->party_id !== null ? 0 : 1],
            ];
        }

        usort($rules, static function (array $a, array $b): int {
            return ($a['key'] <=> $b['key'])
                ?: $b['rule']->min_qty->compareTo($a['rule']->min_qty)
                ?: strcmp($a['rule']->code, $b['rule']->code)
                ?: strcmp($a['rule']->id, $b['rule']->id);
        });

        if ($rules === []) {
            return [[], BigRational::one()];
        }

        $winner = $rules[0]['rule'];
        $applied = [$winner];

        if ($winner->stackable) {
            foreach (array_slice($rules, 1) as $candidate) {
                if ($candidate['rule']->stackable) {
                    $applied[] = $candidate['rule'];
                }
            }
        }

        $remaining = BigRational::one();

        foreach ($applied as $rule) {
            $remaining = $remaining->multipliedBy(BigRational::one()->minus($rule->discount_percent->toBigRational()->dividedBy(100)));
        }

        return [array_map(static fn (DiscountRule $r): string => $r->id, $applied), $remaining];
    }

    private function quantity(string $qty): BigDecimal
    {
        try {
            $value = BigDecimal::of($qty);
        } catch (MathException) {
            CatalogRules::fail('qty', 'qty_positive');
        }

        if ($value->isLessThanOrEqualTo(0)) {
            CatalogRules::fail('qty', 'qty_positive');
        }

        return $value;
    }
}
