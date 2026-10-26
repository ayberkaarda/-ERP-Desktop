<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Validation;

use App\Modules\EDocuments\Ubl\XmlNamespaces;
use Brick\Math\BigDecimal;
use DOMDocument;
use DOMElement;
use DOMXPath;

/** Additional application arithmetic checks; these do not replace official schema rules. */
final class MonetaryRules
{
    /** @return list<array{layer:string,code:string,message:string,path?:string}> */
    public function errors(DOMDocument $document): array
    {
        if ($document->documentElement?->namespaceURI !== XmlNamespaces::INVOICE) {
            return [];
        }
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('cbc', XmlNamespaces::CBC);
        $xpath->registerNamespace('cac', XmlNamespaces::CAC);
        $currency = (string) $xpath->evaluate('string(/*/cbc:DocumentCurrencyCode)');
        $net = BigDecimal::zero();
        $lineTaxes = BigDecimal::zero();
        $lineCount = 0;
        foreach ($xpath->query('/*/cac:InvoiceLine') ?: [] as $line) {
            if (! $line instanceof DOMElement) {
                continue;
            }
            $lineCount++;
            $net = $net->plus((string) $xpath->evaluate('string(cbc:LineExtensionAmount)', $line));
            foreach ($xpath->query('cac:TaxTotal/cbc:TaxAmount', $line) ?: [] as $amount) {
                if ($amount instanceof DOMElement && $amount->getAttribute('currencyID') === $currency) {
                    $lineTaxes = $lineTaxes->plus($amount->textContent);
                }
            }
        }
        $tax = BigDecimal::zero();
        foreach ($xpath->query('/*/cac:TaxTotal/cbc:TaxAmount') ?: [] as $amount) {
            if ($amount instanceof DOMElement && $amount->getAttribute('currencyID') === $currency) {
                $tax = $tax->plus($amount->textContent);
            }
        }
        $value = static fn (string $name): BigDecimal => BigDecimal::of((string) $xpath->evaluate('string(/*/cac:LegalMonetaryTotal/cbc:'.$name.')') ?: '0');
        $errors = (new SupportedInvoiceRules)->errors($xpath);
        if (! $value('LineExtensionAmount')->isEqualTo($net)) {
            $errors[] = $this->error('LINE_TOTAL_MISMATCH', 'The declared line extension total differs from the sum of invoice lines.');
        }
        if (! $value('TaxExclusiveAmount')->isEqualTo($net->minus($value('AllowanceTotalAmount'))->plus($value('ChargeTotalAmount')))) {
            $errors[] = $this->error('NET_TOTAL_MISMATCH', 'The tax-exclusive total does not reconcile with line totals and document allowances/charges.');
        }
        if (! $value('TaxInclusiveAmount')->isEqualTo($value('TaxExclusiveAmount')->plus($tax))) {
            $errors[] = $this->error('GROSS_TOTAL_MISMATCH', 'The tax-inclusive total does not reconcile with the net amount and taxes.');
        }
        if (! $tax->isEqualTo($lineTaxes)) {
            $errors[] = $this->error('TAX_TOTAL_MISMATCH', 'Document and line tax totals in the document currency differ.');
        }
        $withholding = BigDecimal::zero();
        foreach ($xpath->query('/*/cac:WithholdingTaxTotal/cbc:TaxAmount') ?: [] as $amount) {
            if ($amount instanceof DOMElement && $amount->getAttribute('currencyID') === $currency) {
                $withholding = $withholding->plus($amount->textContent);
            }
        }
        if (! $value('PayableAmount')->isEqualTo($value('TaxInclusiveAmount')->minus($value('PrepaidAmount'))->plus($value('PayableRoundingAmount'))->minus($withholding))) {
            $errors[] = $this->error('PAYABLE_TOTAL_MISMATCH', 'The payable total does not reconcile with the invoice amount, prepayments, rounding and withholding.');
        }
        $declaredLines = (string) $xpath->evaluate('string(/*/cbc:LineCountNumeric)');
        if ($declaredLines !== '' && ! BigDecimal::of($declaredLines)->isEqualTo($lineCount)) {
            $errors[] = $this->error('LINE_COUNT_MISMATCH', 'The declared line count differs from the document lines.');
        }

        return $errors;
    }

    /** @return array{layer:string,code:string,message:string} */
    private function error(string $code, string $message): array
    {
        return ['layer' => 'business', 'code' => $code, 'message' => $message];
    }
}
