<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use DateTimeImmutable;

/**
 * The journal entry of an invoice, in company currency, through PostingService (source
 * sales_invoice, purpose main, so a repeated issue cannot book twice):
 *   sale:   Dr sales.receivable (total, party, due date, currency data when foreign)
 *           Cr sales.revenue.goods|services per account (net, discounts netted)
 *           Cr sales.vat_output per tax code
 *   return: the mirror, with sales.returns in place of revenue.
 * VAT per tax code is the document tax converted and rounded; revenue is the total minus VAT,
 * split over the revenue accounts by net amount, so the entry balances and equals the invoice.
 */
final class InvoiceJournal
{
    public const string SOURCE_TYPE = 'sales_invoice';

    public function __construct(
        private readonly PostingService $posting,
        private readonly AccountDeterminer $accounts,
        private readonly ItemLookup $items,
        private readonly SalesSettings $settings,
    ) {}

    /**
     * @param  iterable<SalesInvoiceLine>  $lines
     */
    public function post(SalesInvoice $invoice, iterable $lines, ?string $actor): PostedEntry
    {
        $credit = $invoice->isCreditNote();
        $fx = $invoice->fx_rate;
        $taxes = [];
        $revenue = [];
        $categories = [];

        foreach ($lines as $line) {
            $key = $line->tax_code_id ?? '';
            $taxes[$key] ??= ['tax' => BigDecimal::zero(), 'rate' => (string) $line->tax_rate];
            $taxes[$key]['tax'] = $taxes[$key]['tax']->plus($line->tax_amount);
            $categories[$line->item_id] ??= $this->items->find($line->item_id)?->categoryId;
            $event = $credit ? 'sales.returns' : ($line->item_type === 'service' ? 'sales.revenue.services' : 'sales.revenue.goods');
            $account = $this->accounts->resolve($event, array_filter([
                'item_category' => $categories[$line->item_id],
                'item_id' => $line->item_id,
                'party_id' => $invoice->party_id,
                'currency' => $invoice->currency_code,
                'tax_code' => $line->tax_code_id,
                'warehouse_id' => $line->warehouse_id ?? $invoice->warehouse_id,
            ], static fn (?string $v): bool => $v !== null));
            $revenue[$account->id] ??= BigDecimal::zero();
            $revenue[$account->id] = $revenue[$account->id]->plus($line->net_amount);
        }

        $postingLines = [];
        $total = $invoice->total_local->toScale(2);
        $vatLocal = BigDecimal::zero()->toScale(2);
        $vatLines = [];

        foreach ($taxes as $taxCode => $tax) {
            $local = RoundingPolicy::currency($tax['tax']->multipliedBy($fx));

            if ($local->isZero()) {
                continue;
            }

            $vatLocal = $vatLocal->plus($local);
            $account = $this->accounts->resolve('sales.vat_output', array_filter(['tax_code' => $taxCode === '' ? null : $taxCode, 'currency' => $invoice->currency_code]));
            $vatLines[] = [$account->id, (string) $local, $tax['rate']];
        }

        $net = $total->minus($vatLocal);
        $description = Messages::get($credit ? 'journal_credit_note' : 'journal_invoice', ['number' => (string) $invoice->number, 'party' => $invoice->party_name]);
        $receivable = $this->accounts->resolve('sales.receivable', array_filter(['party_id' => $invoice->party_id, 'currency' => $invoice->currency_code]));
        $foreign = $invoice->currency_code !== $this->settings->baseCurrency();
        $receivableExtra = [
            'partyId' => $invoice->party_id,
            'dueDate' => $invoice->due_date?->format('Y-m-d'),
            'description' => $description,
            'documentRef' => $invoice->number,
            'currency' => $foreign ? $invoice->currency_code : null,
            'fxAmount' => $foreign ? (string) $invoice->total->toScale(2) : null,
            'fxRate' => $foreign ? (string) $fx : null,
        ];

        if ($total->isPositive()) {
            $postingLines[] = $credit
                ? PostingLine::credit($receivable->id, (string) $total, $receivableExtra)
                : PostingLine::debit($receivable->id, (string) $total, $receivableExtra);
        }

        $dimensions = ['costCenterId' => $invoice->cost_center_id, 'projectId' => $invoice->project_id, 'documentRef' => $invoice->number, 'description' => $description];

        if ($net->isPositive() && $revenue !== []) {
            $weights = array_values($revenue);
            $sum = array_reduce($weights, static fn (BigDecimal $c, BigDecimal $w): BigDecimal => $c->plus($w), BigDecimal::zero());
            $parts = $sum->isZero() ? [$net, ...array_fill(0, count($weights) - 1, BigDecimal::zero())] : RoundingPolicy::allocate($net, $weights);

            foreach (array_keys($revenue) as $n => $accountId) {
                if ($parts[$n]->isZero()) {
                    continue;
                }

                $postingLines[] = $credit
                    ? PostingLine::debit($accountId, (string) $parts[$n], $dimensions)
                    : PostingLine::credit($accountId, (string) $parts[$n], $dimensions);
            }
        }

        foreach ($vatLines as [$accountId, $amount, $rate]) {
            $extra = ['description' => $description.' %'.$rate, 'documentRef' => $invoice->number];
            $postingLines[] = $credit ? PostingLine::debit($accountId, $amount, $extra) : PostingLine::credit($accountId, $amount, $extra);
        }

        return $this->posting->post(new PostingRequest(
            $invoice->company_id,
            new DateTimeImmutable($invoice->document_date->format('Y-m-d')),
            EntryType::General,
            $description,
            self::SOURCE_TYPE,
            $invoice->id,
            $postingLines,
            'main',
            $actor,
        ));
    }
}
