<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Contracts\JournalPartyAccountLookup;
use App\Modules\Accounting\Data\AccountRef;
use App\Modules\Purchasing\Contracts\PayableSettlement;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Purchasing\Data\PurchaseInvoiceData;
use App\Modules\Sales\Contracts\ReceivableSettlement;
use App\Modules\Sales\Contracts\SalesInvoiceLookup;
use App\Modules\Sales\Data\SalesInvoiceData;
use App\Modules\Treasury\Contracts\TreasuryInvoiceAccess;
use App\Modules\Treasury\Data\TreasuryInvoiceData;
use App\Modules\Treasury\Data\TreasuryInvoicePageData;
use App\Modules\Treasury\Support\Treasury;

final class InvoiceBridge implements TreasuryInvoiceAccess
{
    public function find(string $module, string $id): ?TreasuryInvoiceData
    {
        $this->module($module);
        $invoice = $module === 'sales' ? app(SalesInvoiceLookup::class)->find($id) : app(PurchaseInvoiceLookup::class)->find($id);

        return $invoice === null ? null : $this->data($module, $invoice);
    }

    public function openForParty(string $module, string $companyId, string $partyId): array
    {
        $this->module($module);
        if ($companyId !== app(CompanyContext::class)->id()) {
            Treasury::fail('company_id', 'unknown');
        }
        $rows = $module === 'sales' ? app(SalesInvoiceLookup::class)->openForParty($companyId, $partyId) : app(PurchaseInvoiceLookup::class)->openForParty($companyId, $partyId);

        $accounts = $this->controlAccounts($module, $rows);

        return array_map(fn ($i) => $this->data($module, $i, $accounts), $rows);
    }

    /** @return list<TreasuryInvoiceData> */
    public function openForCompany(string $module, int $page = 1, int $perPage = 100, ?string $asOf = null): array
    {
        $this->module($module);
        $rows = $module === 'sales' ? app(SalesInvoiceLookup::class)->openForCompany($page, $perPage, $asOf) : app(PurchaseInvoiceLookup::class)->openForCompany($page, $perPage, $asOf);

        $accounts = $this->controlAccounts($module, $rows);

        return array_map(fn ($i) => $this->data($module, $i, $accounts), $rows);
    }

    public function apply(string $module, string $companyId, string $invoiceId, string $amount, string $reference, ?string $effectiveDate = null, ?string $localAmount = null): void
    {
        $this->module($module);
        if ($companyId !== app(CompanyContext::class)->id()) {
            Treasury::fail('company_id', 'unknown');
        }
        $service = $module === 'sales' ? app(ReceivableSettlement::class) : app(PayableSettlement::class);
        $service->apply($companyId, $invoiceId, $amount, $reference, $effectiveDate, $localAmount);
    }

    public function unapply(string $module, string $companyId, string $invoiceId, string $reference, ?string $effectiveDate = null): void
    {
        $this->module($module);
        if ($companyId !== app(CompanyContext::class)->id()) {
            Treasury::fail('company_id', 'unknown');
        }
        $service = $module === 'sales' ? app(ReceivableSettlement::class) : app(PayableSettlement::class);
        $service->unapply($companyId, $invoiceId, $reference, $effectiveDate);
    }

    private function module(string $module): void
    {
        if (! in_array($module, ['sales', 'purchasing'], true)) {
            Treasury::fail('module', 'module_invalid');
        }
    }

    /** @param array<string,AccountRef>|null $accounts */
    private function data(string $module, SalesInvoiceData|PurchaseInvoiceData $i, ?array $accounts = null): TreasuryInvoiceData
    {
        $total = $i instanceof PurchaseInvoiceData ? $i->payable : $i->total;
        $local = $i instanceof PurchaseInvoiceData ? $i->payableLocal : $i->totalLocal;
        if ($local === null) {
            throw new \LogicException('Invoice lookup must provide exact carrying amount.');
        }

        return new TreasuryInvoiceData($i->id, $i->companyId, $module, $i->number, $i->invoiceType, $i->status, $i->partyId, $i->partyName, $i->documentDate, $i->dueDate, $i->currencyCode, $i->fxRate, $total, $local, $i->paidAmount, $i->balanceDue, $i->balanceLocal, (($accounts ?? $this->controlAccounts($module, [$i]))[$i->journalEntryId ?? ''] ?? null)?->id);
    }

    public function findForUpdate(string $module, string $id): ?TreasuryInvoiceData
    {
        $this->module($module);
        $i = $module === 'sales' ? app(SalesInvoiceLookup::class)->findForUpdate($id) : app(PurchaseInvoiceLookup::class)->findForUpdate($id);

        return $i === null ? null : $this->data($module, $i);
    }

    /**
     * @param  list<SalesInvoiceData|PurchaseInvoiceData>  $invoices
     * @return array<string,AccountRef>
     */
    private function controlAccounts(string $module, array $invoices): array
    {
        $requests = [];
        foreach ($invoices as $invoice) {
            $amount = $invoice instanceof PurchaseInvoiceData ? $invoice->payableLocal : $invoice->totalLocal;
            if ($invoice->journalEntryId === null || $amount === null || ! Treasury::decimal($amount)->isPositive()) {
                continue;
            }
            $debit = ($module === 'sales') === ($invoice->invoiceType !== 'return');
            $requests[$invoice->journalEntryId] = ['party_id' => $invoice->partyId, 'side' => $debit ? 'debit' : 'credit', 'amount' => $amount];
        }

        $accounts = [];
        foreach (array_chunk($requests, 500, true) as $batch) {
            $accounts = array_replace($accounts, app(JournalPartyAccountLookup::class)->findMany($batch));
        }

        return $accounts;
    }

    public function openForPartyPage(string $module, string $companyId, string $partyId, int $page = 1, int $perPage = 100): TreasuryInvoicePageData
    {
        $this->module($module);
        if ($companyId !== app(CompanyContext::class)->id()) {
            Treasury::fail('company_id', 'unknown');
        }$result = $module === 'sales' ? app(SalesInvoiceLookup::class)->openForPartyPage($companyId, $partyId, $page, $perPage) : app(PurchaseInvoiceLookup::class)->openForPartyPage($companyId, $partyId, $page, $perPage);
        $accounts = $this->controlAccounts($module, $result->items);

        return new TreasuryInvoicePageData(array_map(fn ($i) => $this->data($module, $i, $accounts), $result->items), $result->total, $result->page, $result->perPage);
    }
}
