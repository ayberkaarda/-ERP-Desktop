<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Reports\Data\PurchaseFact;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Purchase figures of one report group in company currency: purchases (supplier invoices) and
 * returns (debit notes), each net of reversals, net = purchases - returns, VAT, total, withheld VAT
 * and payable (total - withheld) likewise; base quantities bought and returned; counts of invoices
 * and debit notes booked and of reversals in the range.
 */
final class PurchaseBucket
{
    public const array AMOUNT_COLUMNS = ['invoice_count', 'debit_note_count', 'reversal_count', 'purchases_amount', 'returns_amount',
        'net_amount', 'tax_amount', 'total_amount', 'withholding_amount', 'payable_amount'];

    public const array QUANTITY_COLUMNS = ['purchased_quantity', 'returned_quantity', 'net_quantity', 'average_price'];

    public BigDecimal $purchases;

    public BigDecimal $returns;

    public BigDecimal $tax;

    public BigDecimal $withholding;

    public BigDecimal $bought;

    public BigDecimal $returned;

    public string $lastDate = '';

    public string $label = '';

    /** @var array<string, true> */
    private array $invoices = [];

    /** @var array<string, true> */
    private array $debitNotes = [];

    /** @var array<string, true> */
    private array $reversals = [];

    public function __construct()
    {
        $this->purchases = $this->returns = $this->tax = $this->withholding = $this->bought = $this->returned = BigDecimal::zero();
    }

    public function add(PurchaseFact $f): void
    {
        $net = $f->netLocal->multipliedBy($f->sign);
        $qty = $f->baseQuantity->multipliedBy($f->sign);
        // Debit notes take VAT and withheld VAT back.
        $side = $f->debitNote ? -$f->sign : $f->sign;
        $this->tax = $this->tax->plus($f->taxLocal->multipliedBy($side));
        $this->withholding = $this->withholding->plus($f->withholdingLocal->multipliedBy($side));

        if ($f->debitNote) {
            $this->returns = $this->returns->plus($net);
            $this->returned = $this->returned->plus($qty);
        } else {
            $this->purchases = $this->purchases->plus($net);
            $this->bought = $this->bought->plus($qty);
        }

        if ($f->sign < 0) {
            $this->reversals[$f->invoiceId] = true;
        } elseif ($f->debitNote) {
            $this->debitNotes[$f->invoiceId] = true;
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
        return $this->purchases->minus($this->returns);
    }

    /** @return array<string, string|int> */
    public function amounts(): array
    {
        $total = $this->net()->plus($this->tax);

        return [
            'invoice_count' => count($this->invoices),
            'debit_note_count' => count($this->debitNotes),
            'reversal_count' => count($this->reversals),
            'purchases_amount' => Num::money($this->purchases),
            'returns_amount' => Num::money($this->returns),
            'net_amount' => Num::money($this->net()),
            'tax_amount' => Num::money($this->tax),
            'total_amount' => Num::money($total),
            'withholding_amount' => Num::money($this->withholding),
            'payable_amount' => Num::money($total->minus($this->withholding)),
        ];
    }

    /** @return array<string, string|null> */
    public function quantities(): array
    {
        $net = $this->bought->minus($this->returned);

        return [
            'purchased_quantity' => Num::qty($this->bought),
            'returned_quantity' => Num::qty($this->returned),
            'net_quantity' => Num::qty($net),
            'average_price' => Num::ratio($this->net(), $net),
        ];
    }
}
