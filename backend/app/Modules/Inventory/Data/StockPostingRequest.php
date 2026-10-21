<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use DateTimeInterface;

/**
 * A stock document posted by another module (delivery, goods receipt, production). It is stored as
 * a posted stock document and is idempotent per (company, source type, source id, purpose): a
 * repeated request returns the first posting.
 */
final readonly class StockPostingRequest
{
    /**
     * @param  list<StockPostingLine>  $lines
     * @param  string|null  $documentId  id for the stock document to create (generated when null)
     * @param  string|null  $offsetAccountEvent  determination event of the journal offset side (e.g.
     *                                           purchase.goods_received); null uses the document type default
     * @param  bool  $postJournal  false when the caller books the financial effect itself
     * @param  MovementType|null  $movementType  overrides the movement type of the document type
     *                                           (return_in, return_out, production_in, production_out, scrap)
     */
    public function __construct(
        public string $companyId,
        public DocumentType $documentType,
        public ?string $documentId,
        public DateTimeInterface $documentDate,
        public string $warehouseId,
        public ?string $targetWarehouseId,
        public array $lines,
        public ?string $offsetAccountEvent,
        public string $sourceType,
        public string $sourceId,
        public string $purpose = 'main',
        public bool $postJournal = true,
        public ?MovementType $movementType = null,
        public bool $allowExpired = false,
        public ?string $reason = null,
        public ?string $postedBy = null,
    ) {}
}
