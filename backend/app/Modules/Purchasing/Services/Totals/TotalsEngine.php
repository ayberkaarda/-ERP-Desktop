<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Totals;

use App\Core\Money\RoundingPolicy;
use App\Modules\Purchasing\Enums\RoundingScope;
use App\Modules\Purchasing\Support\Messages;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/**
 * Document arithmetic, BigDecimal only (same rules as the sales documents). Per line:
 *   amount      = qty * price * (1 - discount% / 100) - discount_amount
 *   net         = amount, or amount / (1 + rate / 100) when the price includes tax
 *   gross       = qty * price in the same (net) terms; line_discount = gross - net
 *   tax         = net * rate / 100 (per line), or for tax-inclusive lines amount - net
 *   withholding = tax * withholding% / 100 (tevkifat: the withheld share of the VAT)
 * Amounts are rounded to the currency scale (2) half-up by Core RoundingPolicy. With per_total
 * rounding the tax of tax-exclusive lines is computed once per tax code on the summed nets and
 * allocated back to the lines (largest remainder), so the lines still add up to the header.
 * Header totals are sums of the lines, so total = subtotal - discount_total + tax_total holds.
 * Company currency totals: tax per tax code and total are converted and rounded, the net is their
 * difference; discount and withholding are converted on their own.
 */
final class TotalsEngine
{
    /**
     * @param  list<LineInput>  $lines
     */
    public function compute(array $lines, RoundingScope $scope, string $fxRate): TotalsResult
    {
        $fx = BigDecimal::of($fxRate);
        $hundred = BigDecimal::of(100);
        $results = [];
        $groups = [];

        foreach ($lines as $i => $line) {
            $qty = BigDecimal::of($line->quantity);
            $price = BigDecimal::of($line->unitPrice);
            $rate = BigDecimal::of($line->taxRate);
            $grossRaw = $qty->multipliedBy($price);
            $factor = BigDecimal::one()->minus(BigDecimal::of($line->discountPercent)->dividedBy($hundred, 10, RoundingMode::Unnecessary));
            $amountRaw = $grossRaw->multipliedBy($factor)->minus(BigDecimal::of($line->discountAmount));

            if ($amountRaw->isNegative()) {
                Messages::fail("lines.{$i}.discount_amount", 'line_amount_negative');
            }

            if ($line->taxInclusive) {
                $divisor = BigDecimal::one()->plus($rate->dividedBy($hundred, 10, RoundingMode::Unnecessary));
                $amount = RoundingPolicy::currency($amountRaw);
                $net = RoundingPolicy::currency($amountRaw->dividedBy($divisor, 12, RoundingMode::HalfUp));
                $gross = RoundingPolicy::currency($grossRaw->dividedBy($divisor, 12, RoundingMode::HalfUp));
                $tax = $amount->minus($net);
            } else {
                $net = RoundingPolicy::currency($amountRaw);
                $gross = RoundingPolicy::currency($grossRaw);
                $tax = RoundingPolicy::currency($net->multipliedBy($rate)->dividedBy($hundred, 12, RoundingMode::HalfUp));
            }

            if ($gross->isLessThan($net)) {
                $gross = $net;
            }

            $results[$i] = ['gross' => $gross, 'net' => $net, 'tax' => $tax, 'rate' => $rate, 'withholding' => BigDecimal::of($line->withholdingRate)];
            $key = ($line->taxCodeId ?? '').'|'.(string) $rate->toScale(4, RoundingMode::HalfUp);
            $groups[$key] ??= ['tax_code_id' => $line->taxCodeId, 'rate' => $rate, 'lines' => [], 'exclusive' => []];
            $groups[$key]['lines'][] = $i;

            if (! $line->taxInclusive) {
                $groups[$key]['exclusive'][] = $i;
            }
        }

        if ($scope === RoundingScope::PerTotal) {
            foreach ($groups as $group) {
                foreach ($this->groupTax($group['exclusive'], $group['rate'], $results) as $i => $tax) {
                    if (isset($results[$i])) {
                        $results[$i] = [...$results[$i], 'tax' => $tax];
                    }
                }
            }
        }

        $out = [];
        $subtotal = $discount = $taxTotal = $total = $withholdingTotal = BigDecimal::zero()->toScale(2);

        foreach ($results as $i => $r) {
            $lineDiscount = $r['gross']->minus($r['net']);
            $lineTotal = $r['net']->plus($r['tax']);
            $withholding = RoundingPolicy::currency($r['tax']->multipliedBy($r['withholding'])->dividedBy($hundred, 12, RoundingMode::HalfUp));
            $out[$i] = new LineResult((string) $r['gross'], (string) $lineDiscount, (string) $r['net'], (string) $r['tax'], (string) $lineTotal, (string) $withholding);
            $subtotal = $subtotal->plus($r['gross']);
            $discount = $discount->plus($lineDiscount);
            $taxTotal = $taxTotal->plus($r['tax']);
            $total = $total->plus($lineTotal);
            $withholdingTotal = $withholdingTotal->plus($withholding);
        }

        $taxes = [];
        $taxLocal = BigDecimal::zero()->toScale(2);

        foreach ($groups as $group) {
            $base = BigDecimal::zero()->toScale(2);
            $tax = BigDecimal::zero()->toScale(2);

            foreach ($group['lines'] as $i) {
                $base = $base->plus($results[$i]['net']);
                $tax = $tax->plus($results[$i]['tax']);
            }

            $local = RoundingPolicy::currency($tax->multipliedBy($fx));
            $taxLocal = $taxLocal->plus($local);
            $taxes[] = new TaxLine($group['tax_code_id'], (string) $group['rate']->toScale(4), (string) $base, (string) $tax,
                (string) RoundingPolicy::currency($base->multipliedBy($fx)), (string) $local);
        }

        $totalLocal = RoundingPolicy::currency($total->multipliedBy($fx));
        $netLocal = $totalLocal->minus($taxLocal);
        $discountLocal = RoundingPolicy::currency($discount->multipliedBy($fx));
        $withholdingLocal = RoundingPolicy::currency($withholdingTotal->multipliedBy($fx));

        if ($withholdingLocal->isGreaterThan($taxLocal)) {
            $withholdingLocal = $taxLocal;
        }

        return new TotalsResult(
            array_values($out),
            (string) $subtotal,
            (string) $discount,
            (string) $taxTotal,
            (string) $total,
            (string) $netLocal->plus($discountLocal),
            (string) $discountLocal,
            (string) $taxLocal,
            (string) $totalLocal,
            $taxes,
            (string) $withholdingTotal,
            (string) $withholdingLocal,
        );
    }

    /**
     * @param  list<int>  $indexes
     * @param  array<int, array{gross: BigDecimal, net: BigDecimal, tax: BigDecimal, rate: BigDecimal, withholding: BigDecimal}>  $results
     * @return array<int, BigDecimal> line index => tax
     */
    private function groupTax(array $indexes, BigDecimal $rate, array $results): array
    {
        if ($indexes === []) {
            return [];
        }

        $base = BigDecimal::zero();
        $weights = [];

        foreach ($indexes as $i) {
            $base = $base->plus($results[$i]['net']);
            $weights[] = $results[$i]['net'];
        }

        if ($base->isZero()) {
            return [];
        }

        $tax = RoundingPolicy::currency($base->multipliedBy($rate)->dividedBy(100, 12, RoundingMode::HalfUp));
        $parts = RoundingPolicy::allocate($tax, $weights);
        $out = [];

        foreach ($indexes as $n => $i) {
            $out[$i] = $parts[$n];
        }

        return $out;
    }
}
