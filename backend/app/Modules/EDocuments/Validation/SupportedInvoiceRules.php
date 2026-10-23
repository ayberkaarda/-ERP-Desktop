<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Validation;

use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Brick\Math\RoundingMode;
use DOMElement;
use DOMNode;
use DOMXPath;

/** Supported single-VAT arithmetic, checked without altering the document. */
final class SupportedInvoiceRules
{
    /** @return list<array{layer:string,code:string,message:string}> */
    public function errors(DOMXPath $xpath): array
    {
        try {
            $this->check($xpath);

            return [];
        } catch (\DomainException|MathException $exception) {
            return [['layer' => 'business', 'code' => 'UNSUPPORTED_OR_INCONSISTENT_INVOICE', 'message' => $exception->getMessage()]];
        }
    }

    private function check(DOMXPath $x): void
    {
        $root = $x->document->documentElement;
        if (! $root instanceof DOMElement) {
            throw new \DomainException('Missing invoice root.');
        }
        $type = $this->text($x, 'cbc:InvoiceTypeCode', $root);
        if (! in_array($type, ['SATIS', 'ISTISNA', 'IADE'], true) || $x->evaluate('count(//cac:WithholdingTaxTotal)') > 0) {
            throw new \DomainException('Unsupported invoice type or withholding tax components.');
        }
        /** @var array<string, array{base:BigDecimal,tax:BigDecimal}> $groups */
        $groups = [];
        foreach ($x->query('cac:InvoiceLine', $root) ?: [] as $line) {
            if (! $line instanceof DOMElement) {
                continue;
            }
            if ($x->evaluate('count(cac:AllowanceCharge[cbc:ChargeIndicator="true"] | cac:Price/cac:AllowanceCharge)', $line) > 0) {
                throw new \DomainException('Line charges and price allowances are not supported by the snapshot mapper.');
            }
            $base = $this->text($x, 'cac:Price/cbc:BaseQuantity', $line);
            if ($base !== '' && (! $this->decimal($base)->isEqualTo(1) || ($this->text($x, 'cac:Price/cbc:BaseQuantity/@unitCode', $line) !== '' && $this->text($x, 'cac:Price/cbc:BaseQuantity/@unitCode', $line) !== $this->text($x, 'cbc:InvoicedQuantity/@unitCode', $line)))) {
                throw new \DomainException('Non-unit price bases are not supported by the snapshot mapper.');
            }
            $net = $this->decimal($this->text($x, 'cbc:LineExtensionAmount', $line), 4);
            $expected = $this->decimal($this->text($x, 'cac:Price/cbc:PriceAmount', $line))->multipliedBy($this->decimal($this->text($x, 'cbc:InvoicedQuantity', $line)));
            foreach ($x->query('cac:AllowanceCharge/cbc:Amount', $line) ?: [] as $amount) {
                if (! $amount instanceof DOMElement) {
                    continue;
                }
                $expected = $expected->minus($this->decimal($amount->textContent, 4));
            }
            if (! $expected->toScale(max(2, $net->getScale()), RoundingMode::HalfUp)->isEqualTo($net)) {
                throw new \DomainException('Line price, quantity and allowances do not reconcile with the line net amount.');
            }
            if ($x->evaluate('count(cac:TaxTotal/cac:TaxSubtotal)', $line) !== 1.0 || $this->text($x, 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', $line) !== '0015') {
                throw new \DomainException('Only one VAT component per line is supported.');
            }
            $sub = 'cac:TaxTotal/cac:TaxSubtotal/';
            $taxable = $this->decimal($this->text($x, $sub.'cbc:TaxableAmount', $line), 4);
            $tax = $this->decimal($this->text($x, $sub.'cbc:TaxAmount', $line), 4);
            $rate = $this->decimal($this->text($x, $sub.'cbc:Percent', $line));
            if ($rate->isLessThan(0) || $rate->isGreaterThan(100) || ! $taxable->isEqualTo($net) || ! $taxable->multipliedBy($rate)->dividedByExact(100)->toScale(max(2, $tax->getScale()), RoundingMode::HalfUp)->isEqualTo($tax) || ! $tax->isEqualTo($this->decimal($this->text($x, 'cac:TaxTotal/cbc:TaxAmount', $line), 4))) {
                throw new \DomainException('Line VAT taxable amount, rate and tax amount do not reconcile.');
            }
            $key = (string) $rate->strippedOfTrailingZeros();
            $groups[$key] = ['base' => ($groups[$key]['base'] ?? BigDecimal::zero())->plus($taxable), 'tax' => ($groups[$key]['tax'] ?? BigDecimal::zero())->plus($tax)];
        }
        foreach ($x->query('cac:TaxTotal/cac:TaxSubtotal', $root) ?: [] as $sub) {
            if (! $sub instanceof DOMElement) {
                continue;
            }
            $key = (string) $this->decimal($this->text($x, 'cbc:Percent', $sub))->strippedOfTrailingZeros();
            if ($this->text($x, 'cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', $sub) !== '0015' || ! isset($groups[$key]) || ! $groups[$key]['base']->isEqualTo($this->decimal($this->text($x, 'cbc:TaxableAmount', $sub), 4)) || ! $groups[$key]['tax']->isEqualTo($this->decimal($this->text($x, 'cbc:TaxAmount', $sub), 4))) {
                throw new \DomainException('Header VAT breakdown does not match the rounded line VAT groups.');
            }
            unset($groups[$key]);
        }
        if ($groups !== []) {
            throw new \DomainException('Header VAT groups are missing.');
        }
    }

    private function text(DOMXPath $x, string $path, DOMNode $node): string
    {
        return trim((string) $x->evaluate('string('.$path.')', $node));
    }

    private function decimal(string $value, int $scale = 6): BigDecimal
    {
        if (! preg_match('/^-?\d{1,18}(?:\.\d{1,'.$scale.'})?$/D', $value)) {
            throw new \DomainException('Unsupported decimal precision or magnitude.');
        }

        return BigDecimal::of($value);
    }
}
