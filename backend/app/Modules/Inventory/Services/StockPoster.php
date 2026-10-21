<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPosted;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentStatus;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use App\Modules\Inventory\Services\Ledger\PostOptions;
use App\Modules\Inventory\Services\Ledger\StockLedger;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use DateTimeInterface;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * StockService for other modules: stores the request as a stock document and posts it at once.
 */
final class StockPoster implements StockService
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly StockLedger $ledger,
        private readonly ItemLookup $items,
    ) {}

    public function post(StockPostingRequest $request): StockPosted
    {
        return $this->company->runAs($request->companyId, fn (): StockPosted => Stock::transaction(function () use ($request): StockPosted {
            if ($request->sourceType === '' || ! Str::isUuid($request->sourceId)) {
                Messages::fail('source_id', 'source_required');
            }

            // Serializes identical requests; the partial unique index is the second line of defence.
            Stock::lock($request->companyId, 'post.'.hash('sha256', $request->sourceType.'|'.$request->sourceId.'|'.$request->purpose));
            $existing = StockDocument::query()->where('source_type', $request->sourceType)->where('source_id', $request->sourceId)
                ->where('purpose', $request->purpose)->where('status', '<>', DocumentStatus::Draft->value)->first();

            if ($existing !== null) {
                return StockPosted::of($existing, true);
            }

            if ($request->lines === [] || count($request->lines) > StockDocument::MAX_LINES) {
                Messages::fail('lines', 'lines_required');
            }

            if (($request->documentType === DocumentType::Transfer) !== ($request->targetWarehouseId !== null)) {
                Messages::fail('target_warehouse_id', 'target_warehouse_required');
            }

            $doc = new StockDocument([
                'doc_type' => $request->documentType,
                'document_date' => $request->documentDate->format('Y-m-d'),
                'warehouse_id' => $request->warehouseId,
                'target_warehouse_id' => $request->targetWarehouseId,
                'reason' => $request->reason,
                'offset_event' => $request->offsetAccountEvent,
                'allow_expired' => $request->allowExpired,
            ]);

            if ($request->documentId !== null) {
                $doc->id = $request->documentId;
            }

            $doc->source_type = $request->sourceType;
            $doc->source_id = $request->sourceId;
            $doc->purpose = $request->purpose;
            $doc->created_by = $request->postedBy;
            $doc->save();

            foreach ($request->lines as $i => $line) {
                $this->line($doc, $line, $i + 1);
            }

            $posted = $this->ledger->post($doc, new PostOptions(
                $request->postedBy,
                $request->postJournal,
                $request->offsetAccountEvent,
                $request->movementType,
            ));

            return StockPosted::of($posted);
        }));
    }

    public function reverse(string $documentId, DateTimeInterface $date, string $reason): StockPosted
    {
        $doc = StockDocument::query()->whereKey(Str::isUuid($documentId) ? $documentId : null)->firstOrFail();
        $actor = Auth::id();

        return StockPosted::of($this->ledger->reverse($doc, $date, $reason, is_string($actor) ? $actor : null));
    }

    private function line(StockDocument $doc, StockPostingLine $line, int $no): void
    {
        $item = $this->items->find($line->itemId);

        if ($item === null) {
            Messages::fail('lines.'.($no - 1).'.item_id', 'item_missing');
        }

        $row = new StockDocumentLine([
            'line_no' => $no,
            'item_id' => $item->id,
            'unit_id' => $line->unitId ?? $item->baseUnitId,
            'quantity' => Stock::qty($line->quantity),
            'base_quantity' => Stock::qty($line->quantity),
            'unit_cost' => $line->unitCost,
            'lot_no' => $line->lotNo,
            'expiry_date' => $line->expiry,
            'serial_numbers' => $line->serials,
            'location_id' => $line->locationId,
            'target_location_id' => $line->targetLocationId,
            'direction' => $line->direction,
            'notes' => $line->notes,
            'reservation_id' => $line->reservationId,
        ]);
        $row->document_id = $doc->id;
        $row->save();
    }
}
