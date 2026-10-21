<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\RevenueFact;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Sales figures of one report group in company currency: sales (sale invoices) and returns (credit
 * notes), each net of reversals, net = sales - returns, VAT and total likewise; base quantities sold
 * and returned; counts of invoices and credit notes issued and of reversals in the range.
 */
final class SalesBucket
{
    public BigDecimal $sales;

    public BigDecimal $returns;

    public BigDecimal $salesTax;

    public BigDecimal $returnsTax;

    public BigDecimal $sold;

    public BigDecimal $returned;

    /** @var array<string, true> */
    private array $invoices = [];

    /** @var array<string, true> */
    private array $creditNotes = [];

    /** @var array<string, true> */
    private array $reversals = [];

    public string $lastDate = '';

    public string $label = '';

    public function __construct()
    {
        $this->sales = $this->returns = $this->salesTax = $this->returnsTax = $this->sold = $this->returned = BigDecimal::zero();
    }

    public function add(RevenueFact $f): void
    {
        $net = $f->netLocal->multipliedBy($f->sign);
        $tax = $f->taxLocal->multipliedBy($f->sign);
        $qty = $f->baseQuantity->multipliedBy($f->sign);

        if ($f->creditNote) {
            $this->returns = $this->returns->plus($net);
            $this->returnsTax = $this->returnsTax->plus($tax);
            $this->returned = $this->returned->plus($qty);
        } else {
            $this->sales = $this->sales->plus($net);
            $this->salesTax = $this->salesTax->plus($tax);
            $this->sold = $this->sold->plus($qty);
        }

        if ($f->sign < 0) {
            $this->reversals[$f->invoiceId] = true;
        } elseif ($f->creditNote) {
            $this->creditNotes[$f->invoiceId] = true;
        } else {
            $this->invoices[$f->invoiceId] = true;
        }

        if ($f->date >= $this->lastDate) {
            $this->lastDate = $f->date;
            $this->label = $f->partyName;
        }
    }

    public function net(): BigDecimal
    {
        return $this->sales->minus($this->returns);
    }

    public function tax(): BigDecimal
    {
        return $this->salesTax->minus($this->returnsTax);
    }

    /** @return array<string, string|int> */
    public function amounts(): array
    {
        return [
            'invoice_count' => count($this->invoices),
            'credit_note_count' => count($this->creditNotes),
            'reversal_count' => count($this->reversals),
            'sales_amount' => Num::money($this->sales),
            'returns_amount' => Num::money($this->returns),
            'net_amount' => Num::money($this->net()),
            'tax_amount' => Num::money($this->tax()),
            'total_amount' => Num::money($this->net()->plus($this->tax())),
        ];
    }

    /** @return array<string, string|null> */
    public function quantities(): array
    {
        $net = $this->sold->minus($this->returned);

        return [
            'sold_quantity' => Num::qty($this->sold),
            'returned_quantity' => Num::qty($this->returned),
            'net_quantity' => Num::qty($net),
            'average_price' => Num::ratio($this->net(), $net),
        ];
    }

    public const array AMOUNT_COLUMNS = ['invoice_count', 'credit_note_count', 'reversal_count', 'sales_amount', 'returns_amount', 'net_amount', 'tax_amount', 'total_amount'];

    public const array QUANTITY_COLUMNS = ['sold_quantity', 'returned_quantity', 'net_quantity', 'average_price'];
}
