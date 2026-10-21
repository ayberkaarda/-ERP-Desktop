<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\PriceLineRules;
use App\Modules\Catalog\Services\PriceListService;
use App\Modules\Catalog\Services\UnitConverter;
use Illuminate\Validation\Validator;

/**
 * PUT /price-lists/{id}/lines: up to 1000 lines, errors reported per line as lines.<i>.<field>.
 */
final class BulkPriceListLinesRequest extends CatalogRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'lines' => ['required', 'array', 'list', 'min:1', 'max:'.PriceListService::MAX_BULK_LINES],
            'lines.*' => ['required', 'array:item_id,variant_id,unit_id,min_qty,price,valid_from,valid_to,version'],
            ...PriceLineRules::rules('lines.*.'),
            'lines.*.version' => ['sometimes', 'integer', 'min:1'],
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $lines = $this->input('lines');

            if (! is_array($lines) || $validator->errors()->has('lines')) {
                return;
            }

            // Lines with structural errors are already reported; check the others against the data.
            $clean = [];

            foreach ($lines as $index => $line) {
                if (is_array($line) && ! $this->lineHasErrors($validator, (int) $index)) {
                    /** @var array<string, mixed> $line */
                    $clean[$index] = $line;
                }
            }

            PriceLineRules::check($validator, $clean, static fn (int|string $i): string => "lines.{$i}.", new UnitConverter);

            $seen = [];

            foreach ($clean as $index => $line) {
                $key = PriceLineRules::key($line);

                if (isset($seen[$key])) {
                    $validator->errors()->add("lines.{$index}.item_id", CatalogRules::message('line_duplicate', ['line' => $seen[$key]]));
                }

                $seen[$key] ??= $index;
            }
        }];
    }

    private function lineHasErrors(Validator $validator, int $index): bool
    {
        foreach (array_keys($validator->errors()->messages()) as $key) {
            if ($key === "lines.{$index}" || str_starts_with($key, "lines.{$index}.")) {
                return true;
            }
        }

        return false;
    }
}
