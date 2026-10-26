<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Purchasing\Http\Resources\DocumentResource;
use App\Modules\Purchasing\Http\Resources\RequestResource;
use App\Modules\Purchasing\Http\Resources\RfqResource;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Models\PurchaseRfq;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Read side of the six purchasing documents of the offline manifest. Each is a company scoped
 * header with its lines embedded (the line tables touch their header, see the
 * 2027_08_01_200500 migration); the pulled row is the REST resource with lines loaded.
 */
final readonly class PurchasingSyncResource implements SyncResource
{
    /**
     * @param  class-string<Model>  $model
     * @param  class-string<JsonResource>  $resource
     */
    private function __construct(
        private string $name,
        private string $model,
        private string $resource,
    ) {}

    /**
     * @return list<self>
     */
    public static function all(): array
    {
        return [
            new self('purchase-requests', PurchaseRequest::class, RequestResource::class),
            new self('purchase-rfqs', PurchaseRfq::class, RfqResource::class),
            new self('purchase-orders', PurchaseOrder::class, DocumentResource::class),
            new self('purchase-receipts', PurchaseReceipt::class, DocumentResource::class),
            new self('purchase-invoices', PurchaseInvoice::class, DocumentResource::class),
            new self('purchase-returns', PurchaseReturn::class, DocumentResource::class),
        ];
    }

    public function name(): string
    {
        return $this->name;
    }

    public function table(): string
    {
        return (new $this->model)->getTable();
    }

    public function scope(): SyncScope
    {
        return SyncScope::Company;
    }

    /**
     * @return Builder<Model>
     */
    public function query(string $companyId): Builder
    {
        $table = $this->table();

        /** @var Builder<Model> */
        return $this->model::query()
            ->withoutGlobalScopes()
            ->where("{$table}.company_id", $companyId)
            ->with($this->embeds());
    }

    public function positionColumn(): string
    {
        return $this->table().'.sync_txid';
    }

    public function resourceClass(): string
    {
        return $this->resource;
    }

    public function embeds(): array
    {
        return ['lines'];
    }

    public function windowField(): string
    {
        return 'document_date';
    }

    public function parentKey(): ?string
    {
        return null;
    }
}
