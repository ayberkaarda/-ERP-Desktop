<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * Gross debit/credit totals of one account (or a sum of accounts): before the range (opening) and
 * inside it (movement). Totals are opening + movement; the balance is split onto the side it falls.
 */
final readonly class Amounts
{
    public function __construct(
        public BigDecimal $openingDebit,
        public BigDecimal $openingCredit,
        public BigDecimal $debit,
        public BigDecimal $credit,
    ) {}

    public static function zero(): self
    {
        $zero = BigDecimal::zero()->toScale(4);

        return new self($zero, $zero, $zero, $zero);
    }

    public static function of(string $openingDebit, string $openingCredit, string $debit, string $credit): self
    {
        return new self(Money::of($openingDebit), Money::of($openingCredit), Money::of($debit), Money::of($credit));
    }

    public function plus(self $other): self
    {
        return new self(
            $this->openingDebit->plus($other->openingDebit),
            $this->openingCredit->plus($other->openingCredit),
            $this->debit->plus($other->debit),
            $this->credit->plus($other->credit),
        );
    }

    public function totalDebit(): BigDecimal
    {
        return $this->openingDebit->plus($this->debit);
    }

    public function totalCredit(): BigDecimal
    {
        return $this->openingCredit->plus($this->credit);
    }

    /** Debit-positive closing balance. */
    public function balance(): BigDecimal
    {
        return $this->totalDebit()->minus($this->totalCredit());
    }

    /** Debit-positive balance before the range. */
    public function openingBalance(): BigDecimal
    {
        return $this->openingDebit->minus($this->openingCredit);
    }

    public function isZero(): bool
    {
        return $this->openingDebit->isZero() && $this->openingCredit->isZero() && $this->debit->isZero() && $this->credit->isZero();
    }

    /**
     * @return array{opening_debit: string, opening_credit: string, debit: string, credit: string, total_debit: string, total_credit: string, balance_debit: string, balance_credit: string}
     */
    public function toArray(): array
    {
        $balance = $this->balance();

        return [
            'opening_debit' => Money::str($this->openingDebit),
            'opening_credit' => Money::str($this->openingCredit),
            'debit' => Money::str($this->debit),
            'credit' => Money::str($this->credit),
            'total_debit' => Money::str($this->totalDebit()),
            'total_credit' => Money::str($this->totalCredit()),
            'balance_debit' => Money::str($balance->isPositive() ? $balance : BigDecimal::zero()),
            'balance_credit' => Money::str($balance->isNegative() ? $balance->negated() : BigDecimal::zero()),
        ];
    }
}
