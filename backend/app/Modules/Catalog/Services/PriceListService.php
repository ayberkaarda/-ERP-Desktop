<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
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

    public function delete(PriceList $list): void
    {
        CatalogRules::transaction(function () use ($list): void {
            CatalogRules::lock('price_lists');
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
            $line->assertVersion($version);
            $line->fill(collect($data)->only(['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'])->all())->save();

            return $line;
        }, self::LINE_INDEXES);
    }

    public function deleteLine(PriceList $list, PriceListLine $line): void
    {
        CatalogRules::transaction(function () use ($list, $line): void {
            $this->lockList($list);
            $line->delete();
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
                    if (isset($data['version']) && (int) $data['version'] !== $line->currentVersion()) {
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
