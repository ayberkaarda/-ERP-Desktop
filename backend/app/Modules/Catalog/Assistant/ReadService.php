<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Assistant;

use App\Modules\Catalog\Models\Item;

final class ReadService
{
    /** @return array<string, mixed> */
    public function search(string $query): array
    {
        $data = ['query' => $query];
        $query = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $data['query']);
        $rows = Item::query()->where(fn ($q) => $q->where('code', 'ilike', '%'.$query.'%')->orWhere('name', 'ilike', '%'.$query.'%'))->orderBy('code')->limit(21)->get(['id', 'code', 'name', 'base_unit_id', 'type', 'is_active']);

        return ['records' => $rows->take(20)->map(static fn (Item $item): array => ['id' => $item->id, 'code' => $item->code, 'name' => $item->name, 'base_unit_id' => $item->base_unit_id, 'type' => $item->type->value, 'is_active' => $item->is_active])->values()->all(), 'has_more' => $rows->count() > 20];
    }
}
