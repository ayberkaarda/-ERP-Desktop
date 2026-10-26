<?php

declare(strict_types=1);

namespace App\Modules\Parties\Assistant;

use App\Modules\Parties\Models\Party;

final class ReadService
{
    /** @return array<string, mixed> */
    public function search(string $query): array
    {
        $data = ['query' => $query];
        $query = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $data['query']);
        $rows = Party::query()->where(fn ($q) => $q->where('code', 'ilike', '%'.$query.'%')->orWhere('name', 'ilike', '%'.$query.'%'))->orderBy('code')->limit(21)->get(['id', 'code', 'name', 'is_active']);

        return ['records' => $rows->take(20)->map(static fn (Party $party): array => ['id' => $party->id, 'code' => $party->code, 'name' => $party->name, 'is_active' => $party->is_active])->values()->all(), 'has_more' => $rows->count() > 20];
    }
}
