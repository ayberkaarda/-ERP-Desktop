<?php

declare(strict_types=1);

namespace App\Modules\Sales\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Models\SalesReturn;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read side of the five sales document resources. A row is the REST list shape (DocumentResource
 * with line_count) plus the `lines` embed; line tables touch their header, so a line change moves
 * the document in the pull. Window: document_date (manifest window_days).
 */
final class DocumentSyncResource implements SyncResource
{
    /** Manifest resource name => document class. */
    public const array RESOURCES = [
        'sales-quotes' => SalesQuote::class,
        'sales-orders' => SalesOrder::class,
        'sales-deliveries' => SalesDelivery::class,
        'sales-invoices' => SalesInvoice::class,
        'sales-returns' => SalesReturn::class,
    ];

    /**
     * @param  class-string<SalesDocument>  $model
     */
    public function __construct(private readonly string $name, private readonly string $model) {}

    public static function for(string $name): self
    {
        return new self($name, self::RESOURCES[$name]);
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
            ->withoutCompanyScope()
            ->where("{$table}.company_id", $companyId)
            ->withCount('lines')
            ->with($this->embeds());
    }

    public function positionColumn(): string
    {
        return $this->table().'.sync_txid';
    }

    public function resourceClass(): string
    {
        return DocumentResource::class;
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
