<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Contracts;

use App\Modules\Purchasing\Data\PurchaseInvoiceData;

/**
 * Read access to supplier invoices and debit notes of the active company.
 */
interface PurchaseInvoiceLookup
{
    public function find(string $id): ?PurchaseInvoiceData;

    /**
     * Booked or partially paid invoices and debit notes of the supplier with a balance, oldest due first.
     *
     * @return list<PurchaseInvoiceData>
     */
    public function openForParty(string $companyId, string $partyId): array;
}
