<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use Illuminate\Validation\ValidationException;

final class PriceListService
{
    public const array INDEXES = ['price_lists_company_code_unique' => 'code', 'price_lists_default_unique' => 'is_default'];

    public const array LINE_INDEXES = ['price_list_lines_key_unique' => 'item_id'];

    public const int MAX_BULK_LINES = 1000;

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): PriceList
    {
        return CatalogRules::transaction(function () use ($data): PriceList {
            CatalogRules::lock('price_lists');
            $list = new PriceList(collect($data)->only(PriceList::FIELDS)->all());

            if ($list->is_default) {
                $this->clearDefault($list->currency_code, null);
            }

            $list->save();

            return $list;
        }, self::INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(PriceList $list, array $data, int $version): PriceList
    {
        return CatalogRules::transaction(function () use ($list, $data, $version): PriceList {
            CatalogRules::lock('price_lists');
            $list->assertVersion($version);
            $list->fill(collect($data)->only(PriceList::FIELDS)->all());

            if ($list->is_default && ($list->isDirty('is_default') || $list->isDirty('currency_code'))) {
                $this->clearDefault($list->currency_code, $list->id);
            }

            $list->save();

            return $list;
        }, self::INDEXES);
    }

    public function delete(PriceList $list, ?int $version = null): void
    {
        CatalogRules::transaction(function () use ($list, $version): void {
            CatalogRules::lock('price_lists');
            $list = CatalogRules::lockVersion($list, $version);
            // Lines of a deleted list are unreachable; dropping them frees their items for deletion.
            PriceListLine::query()->where('price_list_id', $list->id)->delete();
            $list->delete();
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated line
     */
    public function createLine(PriceList $list, array $data): PriceListLine
    {
        return CatalogRules::transaction(function () use ($list, $data): PriceListLine {
            $this->lockList($list);
            $line = new PriceListLine(collect($data)->only(['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'])->all());
            $this->assertReferences([$line->item_id], [$line->variant_id], [$line->unit_id], '');
            $line->price_list_id = $list->id;
            $line->save();

            return $line;
        }, self::LINE_INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function updateLine(PriceList $list, PriceListLine $line, array $data, int $version): PriceListLine
    {
        return CatalogRules::transaction(function () use ($list, $line, $data, $version): PriceListLine {
            $this->lockList($list);
            $line = CatalogRules::lockVersion($line, $version);
            $line->fill(collect($data)->only(['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'])->all());
            $this->assertReferences([$line->item_id], [$line->variant_id], [$line->unit_id], '');
            $line->save();

            return $line;
        }, self::LINE_INDEXES);
    }

    public function deleteLine(PriceList $list, PriceListLine $line, ?int $version = null): void
    {
        CatalogRules::transaction(function () use ($list, $line, $version): void {
            $this->lockList($list);
            CatalogRules::lockVersion($line, $version)->delete();
        });
    }

    /**
     * Inserts or updates lines matched by their natural key in one transaction; nothing is written
     * when any line fails. A line may carry the version it was read with; a mismatch is a line error.
     *
     * @param  list<array<string, mixed>>  $lines  validated lines
     * @return array{lines: list<PriceListLine>, created: int, updated: int, unchanged: int}
     *
     * @throws ValidationException
     */
    public function upsertLines(PriceList $list, array $lines): array
    {
        return CatalogRules::transaction(function () use ($list, $lines): array {
            $this->lockList($list);
            $live = $this->liveReferences($lines);
            $existing = [];

            foreach (PriceListLine::query()->where('price_list_id', $list->id)->get() as $line) {
                $existing[PriceLineRules::key($this->keyData($line))] = $line;
            }

            $result = [];
            $errors = [];
            $created = 0;
            $updated = 0;
            $unchanged = 0;

            foreach ($lines as $index => $data) {
                $attributes = collect($data)->only(['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'])->all();
                $line = $existing[PriceLineRules::key($data)] ?? null;
                $missing = $this->missingReference($data, $live);

                if ($missing !== null) {
                    $errors["lines.{$index}.{$missing}"] = [CatalogRules::message('reference_gone')];

                    continue;
                }

                if ($line === null) {
                    if (isset($data['version'])) {
                        $errors["lines.{$index}.version"] = [CatalogRules::message('line_not_found')];

                        continue;
                    }

                    $line = new PriceListLine($attributes);
                    $line->price_list_id = $list->id;
                    $line->save();
                    $created++;
                } else {
                    // Overwriting an existing price needs the version it was read with.
                    if (! isset($data['version'])) {
                        $errors["lines.{$index}.version"] = [CatalogRules::message('line_version_required', ['version' => $line->currentVersion()])];

                        continue;
                    }

                    if ((int) $data['version'] !== $line->currentVersion()) {
                        $errors["lines.{$index}.version"] = [CatalogRules::message('line_version', ['version' => $line->currentVersion()])];

                        continue;
                    }

                    $line->fill($attributes)->save();
                    if ($line->wasChanged()) {
                        $updated++;
                    } else {
                        $unchanged++;
                    }
                }

                $result[] = $line;
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            return ['lines' => $result, 'created' => $created, 'updated' => $updated, 'unchanged' => $unchanged];
        }, self::LINE_INDEXES);
    }

    /**
     * @return array<string, string|null>
     */
    private function keyData(PriceListLine $line): array
    {
        return [
            'item_id' => $line->item_id,
            'variant_id' => $line->variant_id,
            'unit_id' => $line->unit_id,
            'min_qty' => (string) $line->min_qty,
            'valid_from' => $line->valid_from?->toDateString(),
        ];
    }

    /**
     * Items, variants and units stay FOR SHARE locked until commit; their deletes lock them FOR
     * UPDATE and check usage, so no line can end up pointing at a deleted record.
     *
     * @param  list<string|null>  $items
     * @param  list<string|null>  $variants
     * @param  list<string|null>  $units
     */
    private function assertReferences(array $items, array $variants, array $units, string $prefix): void
    {
        foreach (['item_id' => [Item::class, $items], 'variant_id' => [ItemVariant::class, $variants], 'unit_id' => [Unit::class, $units]] as $field => [$class, $ids]) {
            if (! CatalogRules::sharedExists($class, $ids)) {
                CatalogRules::fail($prefix.$field, 'reference_gone');
            }
        }
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, array<string, true>> field => live ids, share locked
     */
    private function liveReferences(array $lines): array
    {
        $live = [];

        foreach (['item_id' => Item::class, 'variant_id' => ItemVariant::class, 'unit_id' => Unit::class] as $field => $class) {
            $ids = array_values(array_unique(array_filter(array_map(fn (array $l): mixed => $l[$field] ?? null, $lines), 'is_string')));
            $found = $ids === [] ? [] : $class::query()->whereIn('id', $ids)->sharedLock()->pluck('id')->all();
            $live[$field] = array_fill_keys(array_map('strval', $found), true);
        }

        return $live;
    }

    /**
     * @param  array<string, mixed>  $line
     * @param  array<string, array<string, true>>  $live
     */
    private function missingReference(array $line, array $live): ?string
    {
        foreach ($live as $field => $ids) {
            $id = $line[$field] ?? null;

            if (is_string($id) && ! isset($ids[$id])) {
                return $field;
            }
        }

        return null;
    }

    private function clearDefault(string $currency, ?string $except): void
    {
        PriceList::query()
            ->where('currency_code', $currency)
            ->where('is_default', true)
            ->when($except !== null, fn ($q) => $q->whereKeyNot($except))
            ->get()
            ->each(fn (PriceList $other): bool => $other->forceFill(['is_default' => false])->save());
    }

    private function lockList(PriceList $list): void
    {
        PriceList::query()->whereKey($list->id)->lockForUpdate()->firstOrFail();
    }
}
