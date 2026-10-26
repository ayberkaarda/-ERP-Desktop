<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Assistant;

use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseRequest;

final class ReadService
{
    /** @return array<string, mixed> */
    public function outstanding(string $kind, int $page): array
    {
        $d = ['kind' => $kind, 'page' => $page];
        $query = $d['kind'] === 'orders' ? PurchaseOrder::query()->whereIn('status', OrderStatus::openValues()) : PurchaseRequest::query()->whereIn('status', ['approved', 'partially_ordered']);
        $rows = $query->orderBy('document_date')->orderBy('id')->offset(((int) $d['page'] - 1) * 20)->limit(21)->get();

        return ['kind' => $d['kind'], 'page' => (int) $d['page'], 'has_more' => $rows->count() > 20, 'records' => $rows->take(20)->map(static fn (PurchaseOrder|PurchaseRequest $document): array => ['id' => $document->id, 'number' => $document->number, 'document_date' => $document->document_date->format('Y-m-d'), 'status' => $document->status->value, 'currency_code' => $document->currency_code])->values()->all()];
    }
}
