<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\RevenueFact;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Report-wide totals: the company currency bucket plus the original currency view (per invoice
 * currency: sales, returns and net in that currency next to the net in company currency).
 */
final class RevenueTotals
{
    public SalesBucket $total;

    /** @var array<string, array{sales: BigDecimal, returns: BigDecimal, local: BigDecimal}> */
    private array $currencies = [];

    public function __construct()
    {
        $this->total = new SalesBucket;
    }

    public function add(RevenueFact $f): void
    {
        $this->total->add($f);
        $c = $this->currencies[$f->currencyCode] ?? ['sales' => BigDecimal::zero(), 'returns' => BigDecimal::zero(), 'local' => BigDecimal::zero()];
        $amount = $f->net->multipliedBy($f->sign);
        $c[$f->creditNote ? 'returns' : 'sales'] = $c[$f->creditNote ? 'returns' : 'sales']->plus($amount);
        $c['local'] = $c['local']->plus($f->signedNetLocal());
        $this->currencies[$f->currencyCode] = $c;
    }

    /** @return list<array{currency_code: string, sales_amount: string, returns_amount: string, net_amount: string, net_amount_local: string}> */
    public function byCurrency(): array
    {
        ksort($this->currencies);
        $out = [];

        foreach ($this->currencies as $code => $c) {
            $out[] = [
                'currency_code' => $code,
                'sales_amount' => Num::money($c['sales']),
                'returns_amount' => Num::money($c['returns']),
                'net_amount' => Num::money($c['sales']->minus($c['returns'])),
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
