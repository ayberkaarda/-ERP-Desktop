<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Contracts;

use App\Modules\Purchasing\Data\PurchaseInvoiceData;
use App\Modules\Purchasing\Data\PurchaseInvoicePage;

/**
 * Read access to supplier invoices and debit notes of the active company.
 */
interface PurchaseInvoiceLookup
{
    public function find(string $id): ?PurchaseInvoiceData;

    public function findForUpdate(string $id): ?PurchaseInvoiceData;

    /**
     * Booked or partially paid invoices and debit notes of the supplier with a balance, oldest due first.
     *
     * @return list<PurchaseInvoiceData>
     */
    public function openForParty(string $companyId, string $partyId): array;

    /** Historical open balances, scoped to the active company.
     * @return list<PurchaseInvoiceData> */
    public function openForCompany(int $page = 1, int $perPage = 100, ?string $asOf = null): array;

    public function openForPartyPage(string $companyId, string $partyId, int $page = 1, int $perPage = 100): PurchaseInvoicePage;
}
