<?php

declare(strict_types=1);

namespace App\Modules\Reference\Assistant;

use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\Project;
use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Model;

final class ReadService
{
    /** @return array<string, mixed> */
    public function lookup(string $kind, string $query, int $page): array
    {
        $models = ['warehouses' => Warehouse::class, 'cost_centers' => CostCenter::class, 'projects' => Project::class, 'payment_terms' => PaymentTerm::class];
        $model = $models[$kind] ?? throw new \InvalidArgumentException('Unknown reference kind.');
        $d = ['query' => $query, 'page' => $page];
        $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $d['query']);
        $query = $model::query();
        if ($model === Project::class) {
            $query->where('status', 'active');
        } else {
            $query->where('is_active', true);
        }
        $rows = $query->where(fn ($q) => $q->where('code', 'ilike', '%'.$term.'%')->orWhere('name', 'ilike', '%'.$term.'%'))->orderBy('code')->offset(((int) $d['page'] - 1) * 20)->limit(21)->get(['id', 'code', 'name']);

        return ['page' => (int) $d['page'], 'has_more' => $rows->count() > 20, 'records' => $rows->take(20)->map(static fn (Model $row): array => ['id' => (string) $row->getKey(), 'code' => $row->getAttribute('code'), 'name' => $row->getAttribute('name')])->values()->all()];
    }

    /** @return array<string, mixed> */
    public function currencies(int $page): array
    {
        $d = ['page' => $page];
        $rows = CompanyCurrency::query()->where('is_active', true)->orderBy('currency_code')->offset(((int) $d['page'] - 1) * 20)->limit(21)->get(['currency_code']);

        return ['currencies' => $rows->take(20)->pluck('currency_code')->all(), 'page' => (int) $d['page'], 'has_more' => $rows->count() > 20];
    }
}
