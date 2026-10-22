<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Purchasing\Http\Resources\DocumentResource;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Services\PrintModel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Orders, receipts, invoices and returns: filters status, party_id, currency_code, warehouse_id,
 * source_type (+ type extras); q = number, supplier name, notes; sorts document_date, number,
 * party_name, total, total_local, status, due_date, created_at. Print model for each document.
 */
abstract class PurchaseDocumentController extends PurchasingController
{
    /** @return class-string<PurchaseDocument> */
    abstract protected function model(): string;

    protected function resource(): string
    {
        return DocumentResource::class;
    }

    protected function lineModel(): string
    {
        return $this->model()::lineClass();
    }

    protected function filters(): array
    {
        return ['status', 'party_id', 'currency_code', 'warehouse_id', 'source_type'];
    }

    protected function sorts(): array
    {
        return ['document_date', 'number', 'party_name', 'total', 'total_local', 'status', 'due_date', 'created_at'];
    }

    protected function searchable(): array
    {
        return ['number', 'party_name', 'notes'];
    }

    protected function supplierFilter(Builder $query, string $partyId): void
    {
        $query->where('party_id', $partyId);
    }

    protected function exportHeadings(): array
    {
        return ['number', 'status', 'document_date', 'due_date', 'party_name', 'party_tax_number', 'currency_code', 'fx_rate',
            'subtotal', 'discount_total', 'tax_total', 'withholding_total', 'total', 'total_local'];
    }

    protected function exportRow(Model $doc): array
    {
        /** @var PurchaseDocument $doc */
        return [
            $doc->number, $doc->currentStatus(), $doc->document_date->format('Y-m-d'), $doc->due_date?->format('Y-m-d'), $doc->party_name,
            $doc->party_tax_number, $doc->currency_code, (string) $doc->fx_rate, (string) $doc->subtotal, (string) $doc->discount_total,
            (string) $doc->tax_total, (string) $doc->withholding_total, (string) $doc->total, (string) $doc->total_local,
        ];
    }

    public function printModel(Request $request, string $id, PrintModel $print): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        $doc = $this->find($id);
        Gate::authorize('view', $doc);

        /** @var PurchaseDocument $doc */
        return ApiResponse::success($print->build($doc, $request));
    }

    protected function document(string $id, string $ability): PurchaseDocument
    {
        /** @var PurchaseDocument $doc */
        $doc = $this->find($id);
        Gate::authorize($ability, $doc);

        return $doc;
    }

    protected function isInvoice(Model $doc): bool
    {
        return $doc instanceof PurchaseInvoice;
    }
}
