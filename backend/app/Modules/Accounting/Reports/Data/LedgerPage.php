<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * A page of ledger lines (general ledger or account statement) with the figures of the whole range:
 * opening balance before it, movement totals and closing balance (debit positive).
 */
final readonly class LedgerPage
{
    /**
     * @param  list<LedgerLine>  $lines
     */
    public function __construct(
        public ReportRange $range,
        public Source $source,
        public BigDecimal $openingBalance,
        public BigDecimal $debit,
        public BigDecimal $credit,
        public array $lines,
        public int $total,
        public int $page,
        public int $perPage,
    ) {}

    public function closingBalance(): BigDecimal
    {
        return $this->openingBalance->plus($this->debit)->minus($this->credit);
    }

    public function lastPage(): int
    {
        return max(1, (int) ceil($this->total / max(1, $this->perPage)));
    }

    /**
     * @return array{opening_balance: string, closing_balance: string, totals: array{debit: string, credit: string}}
     */
    public function figures(): array
    {
        return [
            'opening_balance' => Money::str($this->openingBalance),
            'closing_balance' => Money::str($this->closingBalance()),
            'totals' => ['debit' => Money::str($this->debit), 'credit' => Money::str($this->credit)],
        ];
    }

    /**
     * @return array{current_page: int, per_page: int, total: int, last_page: int}
     */
    public function pagination(): array
    {
        return ['current_page' => $this->page, 'per_page' => $this->perPage, 'total' => $this->total, 'last_page' => $this->lastPage()];
    }
}
