<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Sync;

use App\Core\Company\CompanyScope;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Inventory\Http\Resources\StockDocumentResource;
use App\Modules\Inventory\Models\StockDocument;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read side of `stock-documents` (offline-manifest.json): header rows with their lines, in the
 * REST shape. Lines are not a resource of their own; a change to one moves the header's
 * sync position (syncable parent touch). Stock balances and movements are snapshots / the
 * append-only ledger and are not synced.
 */
final class StockDocumentSyncResource implements SyncResource
{
    public const string NAME = 'stock-documents';

    public function name(): string
    {
        return self::NAME;
    }

    public function table(): string
    {
        return 'stock_documents';
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
        // Lines follow the explicit company too, never the ambient CompanyContext.
        $lines = static fn ($query) => $query->withoutGlobalScope(CompanyScope::class)->where('stock_document_lines.company_id', $companyId);

        /** @var Builder<Model> */
        return StockDocument::query()
            ->withoutCompanyScope()
            ->where('stock_documents.company_id', $companyId)
            ->with(['lines' => $lines]);
    }

    public function positionColumn(): string
    {
        return 'stock_documents.sync_txid';
    }

    public function resourceClass(): string
    {
        return StockDocumentResource::class;
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
