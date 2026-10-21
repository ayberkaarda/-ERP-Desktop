<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * Yevmiye defteri page. carriedForward: entries of the same fiscal year before the range (the first
 * "devreden"); pageBroughtForward ("devreden" of this page) adds the entries of earlier pages of the
 * range; page totals added to it give the "nakledilen" amount carried to the next page.
 */
final readonly class JournalBook
{
    /**
     * @param  list<JournalBookEntry>  $entries
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $carriedForward
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $pageBroughtForward
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $pageTotals
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $rangeTotals
     */
    public function __construct(
        public ReportRange $range,
        public Source $source,
        public array $entries,
        public array $carriedForward,
        public array $pageBroughtForward,
        public array $pageTotals,
        public array $rangeTotals,
        public int $total,
        public int $page,
        public int $perPage,
    ) {}

    /**
     * @return array{debit: BigDecimal, credit: BigDecimal}
     */
    public function pageCarriedForward(): array
    {
        return [
            'debit' => $this->pageBroughtForward['debit']->plus($this->pageTotals['debit']),
            'credit' => $this->pageBroughtForward['credit']->plus($this->pageTotals['credit']),
        ];
    }

    public function lastPage(): int
    {
        return max(1, (int) ceil($this->total / max(1, $this->perPage)));
    }

    /**
     * @param  array{debit: BigDecimal, credit: BigDecimal}  $pair
     * @return array{debit: string, credit: string}
     */
    public static function str(array $pair): array
    {
        return ['debit' => Money::str($pair['debit']), 'credit' => Money::str($pair['credit'])];
    }
}
