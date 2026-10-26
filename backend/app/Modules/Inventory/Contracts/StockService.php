<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Contracts;

use App\Modules\Inventory\Data\StockPosted;
use App\Modules\Inventory\Data\StockPostingRequest;
use DateTimeInterface;

/**
 * The only way documents of other modules move stock. Each call is one database transaction
 * (a savepoint inside the caller's): movements, balances, cost layers, serials and the journal
 * entry through Accounting's PostingService.
 */
interface StockService
{
    /** Idempotent per (company, source type, source id, purpose). */
    public function post(StockPostingRequest $request): StockPosted;

    /**
     * Mirrors the movements of a posted stock document of the active company on $date, reverses its
     * journal entry and marks the document cancelled.
     */
    public function reverse(string $documentId, DateTimeInterface $date, string $reason): StockPosted;
}
