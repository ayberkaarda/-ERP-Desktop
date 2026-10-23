<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

use App\Modules\Sales\Data\SalesInvoiceData;
use App\Modules\Sales\Data\SalesInvoicePage;

/**
 * Read access to invoices and credit notes of the active company.
 */
interface SalesInvoiceLookup
{
    public function find(string $id): ?SalesInvoiceData;

    public function findForUpdate(string $id): ?SalesInvoiceData;

    /**
     * Issued or partially paid invoices and credit notes of the party with a balance, oldest due first.
     *
     * @return list<SalesInvoiceData>
     */
    public function openForParty(string $companyId, string $partyId): array;

    /** Historical open balances, scoped to the active company.
     * @return list<SalesInvoiceData> */
    public function openForCompany(int $page = 1, int $perPage = 100, ?string $asOf = null): array;

    public function openForPartyPage(string $companyId, string $partyId, int $page = 1, int $perPage = 100): SalesInvoicePage;
}
