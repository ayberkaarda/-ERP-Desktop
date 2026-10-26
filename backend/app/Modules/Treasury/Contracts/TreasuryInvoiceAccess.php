<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

use App\Modules\Treasury\Data\TreasuryInvoiceData;
use App\Modules\Treasury\Data\TreasuryInvoicePageData;

interface TreasuryInvoiceAccess
{
    public function find(string $module, string $id): ?TreasuryInvoiceData;

    public function findForUpdate(string $module, string $id): ?TreasuryInvoiceData;

    /** @return list<TreasuryInvoiceData> */
    public function openForParty(string $module, string $companyId, string $partyId): array;

    /** Historical balances at the effective accounting date.
     * @return list<TreasuryInvoiceData> */
    public function openForCompany(string $module, int $page = 1, int $perPage = 100, ?string $asOf = null): array;

    public function apply(string $module, string $companyId, string $invoiceId, string $amount, string $reference, ?string $effectiveDate = null, ?string $localAmount = null): void;

    public function unapply(string $module, string $companyId, string $invoiceId, string $reference, ?string $effectiveDate = null): void;

    public function openForPartyPage(string $module, string $companyId, string $partyId, int $page = 1, int $perPage = 100): TreasuryInvoicePageData;
}
