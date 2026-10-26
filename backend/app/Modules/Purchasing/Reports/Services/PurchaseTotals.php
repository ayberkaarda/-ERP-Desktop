<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Reports\Data\PurchaseFact;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Report-wide totals: the company currency bucket plus the original currency view (per invoice
 * currency: purchases, returns and net in that currency next to the net in company currency).
 */
final class PurchaseTotals
{
    public PurchaseBucket $total;

    /** @var array<string, array{purchases: BigDecimal, returns: BigDecimal, local: BigDecimal}> */
    private array $currencies = [];

    public function __construct()
    {
        $this->total = new PurchaseBucket;
    }

    public function add(PurchaseFact $f): void
    {
        $this->total->add($f);
        $c = $this->currencies[$f->currencyCode] ?? ['purchases' => BigDecimal::zero(), 'returns' => BigDecimal::zero(), 'local' => BigDecimal::zero()];
        $side = $f->debitNote ? 'returns' : 'purchases';
        $c[$side] = $c[$side]->plus($f->net->multipliedBy($f->sign));
        $c['local'] = $c['local']->plus($f->signedNetLocal());
        $this->currencies[$f->currencyCode] = $c;
    }

    /** @return list<array{currency_code: string, purchases_amount: string, returns_amount: string, net_amount: string, net_amount_local: string}> */
    public function byCurrency(): array
    {
        ksort($this->currencies);
        $out = [];

        foreach ($this->currencies as $code => $c) {
            $out[] = [
                'currency_code' => (string) $code,
                'purchases_amount' => Num::money($c['purchases']),
                'returns_amount' => Num::money($c['returns']),
                'net_amount' => Num::money($c['purchases']->minus($c['returns'])),
                'net_amount_local' => Num::money($c['local']),
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public function meta(): array
    {
        return ['totals' => $this->total->amounts(), 'by_currency' => $this->byCurrency()];
    }
}
