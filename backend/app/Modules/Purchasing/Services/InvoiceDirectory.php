<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Purchasing\Data\PurchaseInvoiceData;
use App\Modules\Purchasing\Data\PurchaseInvoicePage;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class InvoiceDirectory implements PurchaseInvoiceLookup
{
    public function find(string $id): ?PurchaseInvoiceData
    {
        $invoice = Str::isUuid($id) ? $this->query()->find($id) : null;

        return $invoice === null ? null : $this->data($invoice);
    }

    public function findForUpdate(string $id): ?PurchaseInvoiceData
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Invoice locks require a transaction.');
        }$invoice = Str::isUuid($id) ? $this->query()->whereKey($id)->lockForUpdate()->first() : null;

        return $invoice === null ? null : $this->data($invoice);
    }

    public function openForParty(string $companyId, string $partyId): array
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): array => array_values($this->openQuery($partyId)->get()->map(fn (PurchaseInvoice $invoice): PurchaseInvoiceData => $this->data($invoice))->all()));
    }

    public function openForPartyPage(string $companyId, string $partyId, int $page = 1, int $perPage = 100): PurchaseInvoicePage
    {
        return app(CompanyContext::class)->runAs($companyId, function () use ($partyId, $page, $perPage): PurchaseInvoicePage {
            $page = max(1, $page);
            $perPage = min(500, max(1, $perPage));
            $q = $this->openQuery($partyId);
            $total = (clone $q)->count();
            $items = array_values($q->offset(($page - 1) * $perPage)->limit($perPage)->get()->map(fn (PurchaseInvoice $invoice): PurchaseInvoiceData => $this->data($invoice))->all());

            return new PurchaseInvoicePage($items, $total, $page, $perPage);
        });
    }

    /** @return Builder<PurchaseInvoice> */
    private function openQuery(string $partyId): Builder
    {
        return $this->query()->where('party_id', $partyId)->whereIn('status', InvoiceStatus::open())->where('balance_due', '>', 0)->orderBy('due_date')->orderBy('document_date')->orderBy('id');
    }

    /** @return Builder<PurchaseInvoice> */
    private function query(): Builder
    {
        $settled = DB::table('purchase_payable_applications as a')->where('a.company_id', app(CompanyContext::class)->id())->whereColumn('a.invoice_id', 'purchase_invoices.id')->whereNull('a.unapplied_at')->selectRaw('coalesce(sum(coalesce(a.local_amount,round(a.amount * (purchase_invoices.total_local - purchase_invoices.withholding_total_local) / nullif((purchase_invoices.total - purchase_invoices.withholding_total),0),2))),0)');

        return PurchaseInvoice::query()->select('purchase_invoices.*')->selectSub($settled, 'treasury_settled_local');
    }

    /** @return list<PurchaseInvoiceData> */
    public function openForCompany(int $page = 1, int $perPage = 100, ?string $asOf = null): array
    {
        $asOf ??= now()->toDateString();
        $company = app(CompanyContext::class)->id();
        $applications = DB::table('purchase_payable_applications as a')->where('a.company_id', $company)->whereColumn('a.invoice_id', 'purchase_invoices.id')->whereRaw('coalesce(a.effective_date,a.applied_at::date) <= ?', [$asOf])->where(fn ($q) => $q->whereNull('a.unapplied_at')->orWhereRaw('coalesce(a.unapplied_effective_date,a.unapplied_at::date) > ?', [$asOf]));
        $paid = (clone $applications)->selectRaw('coalesce(sum(a.amount),0)');
        $paidLocal = (clone $applications)->selectRaw('coalesce(sum(coalesce(a.local_amount,round(a.amount * (purchase_invoices.total_local - purchase_invoices.withholding_total_local) / nullif((purchase_invoices.total - purchase_invoices.withholding_total),0),2))),0)');
        $q = PurchaseInvoice::query()->where('document_date', '<=', $asOf)->whereIn('status', ['booked', 'partially_paid', 'paid', 'reversed'])->where(fn ($q) => $q->where('status', '<>', 'reversed')->orWhere('reversal_date', '>', $asOf))->select('purchase_invoices.*')->selectSub($paid, 'treasury_paid_asof')->selectSub($paidLocal, 'treasury_settled_local')->where(DB::raw('(total - withholding_total)'), '>', $paid)->orderBy('due_date')->orderBy('document_date')->orderBy('id')->offset((max(1, $page) - 1) * min(500, max(1, $perPage)))->limit(min(500, max(1, $perPage)));

        return array_values($q->get()->map(function (PurchaseInvoice $invoice): PurchaseInvoiceData {
            $paid = (string) $invoice->getAttribute('treasury_paid_asof');
            $invoice->setAttribute('paid_amount', $paid);
            $invoice->setAttribute('balance_due', (string) $invoice->payable()->minus($paid));

            return $this->data($invoice);
        })->all());
    }

    private function data(PurchaseInvoice $invoice): PurchaseInvoiceData
    {
        $invoice->setAttribute('treasury_balance_local', (string) $invoice->total_local->minus($invoice->withholding_total_local)->minus((string) $invoice->getAttribute('treasury_settled_local'))->toScale(4));

        return PurchaseInvoiceData::of($invoice);
    }
}
