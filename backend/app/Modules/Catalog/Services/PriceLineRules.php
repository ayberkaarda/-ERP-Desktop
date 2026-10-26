<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Catalog\Models\ItemVariant;
use Illuminate\Validation\Validator;

/**
 * Validation of price list lines shared by the single-line endpoints and the bulk upsert.
 * Domain checks run in batches (a few queries for up to 1000 lines) and report per line.
 */
final class PriceLineRules
{
    public const string DECIMAL = '/^\d{1,14}(\.\d{1,6})?$/';

    /**
     * @return array<string, list<string>>
     */
    public static function rules(string $prefix, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return [
            $prefix.'item_id' => [$required, 'uuid'],
            $prefix.'variant_id' => ['sometimes', 'nullable', 'uuid'],
            $prefix.'unit_id' => [$required, 'uuid'],
            $prefix.'min_qty' => ['sometimes', 'string', 'regex:'.self::DECIMAL],
            $prefix.'price' => [$required, 'string', 'regex:'.self::DECIMAL],
            $prefix.'valid_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            $prefix.'valid_to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * Natural key of a line: (item, variant, unit, min_qty, valid_from).
     *
     * @param  array<string, mixed>  $line
     */
    public static function key(array $line): string
    {
        $min = is_string($line['min_qty'] ?? null) ? (string) RoundingPolicy::decimal($line['min_qty']) : '0.000000';

        return implode('|', [
            $line['item_id'] ?? '',
            $line['variant_id'] ?? '',
            $line['unit_id'] ?? '',
            $min,
            $line['valid_from'] ?? '',
        ]);
    }

    /**
     * Adds "<prefix(i)>field" errors for lines whose item, variant, unit or dates are not usable.
     *
     * @param  array<int|string, array<string, mixed>>  $lines  index => complete line
     * @param  callable(int|string): string  $prefix
     */
    public static function check(Validator $validator, array $lines, callable $prefix, UnitConverter $converter): void
    {
        $itemIds = array_values(array_unique(array_filter(array_map(
            static fn (array $l): ?string => is_string($l['item_id'] ?? null) ? $l['item_id'] : null,
            $lines,
        ))));
        $converter->preload($itemIds);

        $variantIds = array_values(array_unique(array_filter(array_map(
            static fn (array $l): ?string => is_string($l['variant_id'] ?? null) ? $l['variant_id'] : null,
            $lines,
        ))));
        $variants = $variantIds === [] ? [] : ItemVariant::query()->whereIn('id', $variantIds)->pluck('item_id', 'id')->all();

        foreach ($lines as $index => $line) {
            $p = $prefix($index);
            $item = is_string($line['item_id'] ?? null) ? $line['item_id'] : null;
            $base = $item === null ? null : $converter->baseUnitOf($item);

            if ($item === null || $base === null) {
                $validator->errors()->add($p.'item_id', CatalogRules::message('item_missing'));

                continue;
            }

            $variant = $line['variant_id'] ?? null;

            if (is_string($variant) && ($variants[$variant] ?? null) !== $item) {
                $validator->errors()->add($p.'variant_id', CatalogRules::message('variant_mismatch'));
            }

            $unit = $line['unit_id'] ?? null;

            if (! is_string($unit) || ! $converter->canConvert($unit, $base, $item)) {
                $validator->errors()->add($p.'unit_id', CatalogRules::message('conversion_missing'));
            }

            $from = $line['valid_from'] ?? null;
            $to = $line['valid_to'] ?? null;

            if (is_string($from) && is_string($to) && $to < $from) {
                $validator->errors()->add($p.'valid_to', CatalogRules::message('invalid_validity'));
            }
        }
    }
}
