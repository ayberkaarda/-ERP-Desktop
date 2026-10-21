<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

use App\Modules\Sales\Data\SalesInvoiceData;

/**
 * Read access to invoices and credit notes of the active company.
 */
interface SalesInvoiceLookup
{
    public function find(string $id): ?SalesInvoiceData;

    /**
     * Issued or partially paid invoices and credit notes of the party with a balance, oldest due first.
     *
     * @return list<SalesInvoiceData>
     */
    public function openForParty(string $companyId, string $partyId): array;
}
