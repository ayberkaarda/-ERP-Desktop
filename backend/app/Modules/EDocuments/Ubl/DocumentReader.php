<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Ubl;

use App\Modules\EDocuments\Validation\SafeXml;
use App\Modules\EDocuments\Validation\SupportedInvoiceRules;
use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Validation\ValidationException;

final readonly class DocumentReader
{
    public function __construct(private SafeXml $safe) {}

    /** @return array<string, mixed> */
    public function read(string $xml): array
    {
        $document = $this->safe->load($xml);
        $root = $document->documentElement;
        if (! $root instanceof DOMElement || ! in_array($root->namespaceURI, [XmlNamespaces::INVOICE, XmlNamespaces::DESPATCH], true)) {
            throw ValidationException::withMessages(['xml' => 'Unsupported UBL document root.']);
        }
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('cac', XmlNamespaces::CAC);
        $xpath->registerNamespace('cbc', XmlNamespaces::CBC);
        $despatch = $root->namespaceURI === XmlNamespaces::DESPATCH;
        if (! $despatch && (! in_array($this->value($xpath, './cbc:InvoiceTypeCode', $root), ['SATIS', 'ISTISNA', 'IADE'], true) || $xpath->evaluate('count(./cac:WithholdingTaxTotal)', $root) > 0)) {
            throw ValidationException::withMessages(['xml' => 'Unsupported invoice type or withholding components.']);
        }
        if (! $despatch && (new SupportedInvoiceRules)->errors($xpath) !== []) {
            throw ValidationException::withMessages(['xml' => 'Unsupported or inconsistent invoice monetary components.']);
        }
        $profile = $this->value($xpath, './cbc:ProfileID', $root);
        if (! in_array($profile, ['TEMELFATURA', 'TICARIFATURA', 'IHRACAT', 'KAMU', 'EARSIVFATURA', 'TEMELIRSALIYE'], true)) {
            throw ValidationException::withMessages(['xml' => 'The document profile is not supported by the current document mapper.']);
        }
        $lines = [];
        $subtotal = BigDecimal::zero();
        $discount = BigDecimal::zero();
        foreach ($xpath->query($despatch ? './cac:DespatchLine' : './cac:InvoiceLine', $root) ?: [] as $line) {
            if (! $line instanceof DOMElement || count($lines) >= 500) {
                throw ValidationException::withMessages(['xml' => 'The document has too many lines.']);
            }
            $taxes = $xpath->query('./cac:TaxTotal/cac:TaxSubtotal', $line);
            $taxCode = $this->value($xpath, './cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', $line);
            if (! $despatch && (($taxes !== false && $taxes->length > 1) || $taxCode !== '0015' || $xpath->evaluate('count(cac:WithholdingTaxTotal)', $line) > 0)) {
                throw ValidationException::withMessages(['xml' => 'The mapper cannot discard multiple or non-VAT line tax components.']);
            }
            $lineDiscount = BigDecimal::zero();
            foreach ($xpath->query('./cac:AllowanceCharge[cbc:ChargeIndicator="false"]/cbc:Amount', $line) ?: [] as $allowance) {
                if ($allowance instanceof DOMElement) {
                    $lineDiscount = $lineDiscount->plus($this->decimal($allowance->textContent));
                }
            }
            $lineNet = $despatch ? '0' : $this->value($xpath, './cbc:LineExtensionAmount', $line);
            $subtotal = $subtotal->plus($this->decimal($lineNet))->plus($lineDiscount);
            $discount = $discount->plus($lineDiscount);
            $lines[] = [
                'id' => $this->value($xpath, './cbc:ID', $line),
                'item_code' => $this->value($xpath, './cac:Item/cac:SellersItemIdentification/cbc:ID', $line),
                'name' => $this->value($xpath, './cac:Item/cbc:Name', $line),
                'quantity' => $this->value($xpath, $despatch ? './cbc:DeliveredQuantity' : './cbc:InvoicedQuantity', $line),
                'unit_code' => $this->value($xpath, $despatch ? './cbc:DeliveredQuantity/@unitCode' : './cbc:InvoicedQuantity/@unitCode', $line),
                'unit_price' => $despatch ? '0' : $this->value($xpath, './cac:Price/cbc:PriceAmount', $line),
                'net_amount' => $lineNet,
                'tax_rate' => $despatch ? '0' : $this->value($xpath, './cac:TaxTotal/cac:TaxSubtotal/cbc:Percent', $line),
                'tax_amount' => $despatch ? '0' : $this->value($xpath, './cac:TaxTotal/cbc:TaxAmount', $line),
                'discount_amount' => (string) $lineDiscount,
                'tax_type_code' => $taxCode ?: '0015',
            ];
        }
        $supplierPath = $despatch ? './cac:DespatchSupplierParty/cac:Party' : './cac:AccountingSupplierParty/cac:Party';
        $customerPath = $despatch ? './cac:DeliveryCustomerParty/cac:Party' : './cac:AccountingCustomerParty/cac:Party';
        $discount = $discount->plus($this->decimal($this->value($xpath, './cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount', $root) ?: '0'));

        return [
            'kind' => $despatch ? 'e_despatch' : ($profile === 'EARSIVFATURA' ? 'e_archive' : 'e_invoice'),
            'profile' => $profile,
            'uuid' => $this->value($xpath, './cbc:UUID', $root),
            'number' => $this->value($xpath, './cbc:ID', $root),
            'issue_date' => $this->value($xpath, './cbc:IssueDate', $root),
            'issue_time' => $this->value($xpath, './cbc:IssueTime', $root) ?: '00:00:00',
            'invoice_type' => $despatch ? 'SEVK' : $this->value($xpath, './cbc:InvoiceTypeCode', $root),
            'currency' => $despatch ? 'XXX' : $this->value($xpath, './cbc:DocumentCurrencyCode', $root),
            'fx_rate' => $this->value($xpath, './cac:PricingExchangeRate/cbc:CalculationRate', $root) ?: '1',
            'supplier' => $this->party($xpath, $supplierPath, $root),
            'customer' => $this->party($xpath, $customerPath, $root),
            'lines' => $lines,
            'totals' => ['subtotal' => (string) $subtotal, 'discount' => (string) $discount, 'tax' => $despatch ? '0' : $this->value($xpath, './cac:TaxTotal/cbc:TaxAmount', $root), 'total' => $despatch ? '0' : $this->value($xpath, './cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', $root), 'payable' => $despatch ? '0' : $this->value($xpath, './cac:LegalMonetaryTotal/cbc:PayableAmount', $root)],
            'metadata' => ['signature_verified' => false, 'monetary_values_present' => ! $despatch, 'document_allowance' => $this->value($xpath, './cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount', $root) ?: '0', 'document_charge' => $this->value($xpath, './cac:LegalMonetaryTotal/cbc:ChargeTotalAmount', $root) ?: '0', 'prepaid_amount' => $this->value($xpath, './cac:LegalMonetaryTotal/cbc:PrepaidAmount', $root) ?: '0', 'rounding_amount' => $this->value($xpath, './cac:LegalMonetaryTotal/cbc:PayableRoundingAmount', $root) ?: '0'],
        ];
    }

    /** @return array<string, mixed> */
    private function party(DOMXPath $xpath, string $path, DOMNode $root): array
    {
        $taxPath = $path.'/cac:PartyIdentification/cbc:ID[@schemeID="VKN" or @schemeID="TCKN"]';
        if ($xpath->evaluate('count('.$taxPath.')', $root) !== 1.0) {
            throw ValidationException::withMessages(['xml' => 'A party must have exactly one VKN or TCKN identity.']);
        }

        return [
            'tax_number' => $this->value($xpath, $taxPath, $root),
            'tax_scheme' => $this->value($xpath, $taxPath.'/@schemeID', $root),
            'name' => $this->value($xpath, $path.'/cac:PartyName/cbc:Name', $root),
            'tax_office' => $this->value($xpath, $path.'/cac:PartyTaxScheme/cac:TaxScheme/cbc:Name', $root),
            'address' => ['street' => $this->value($xpath, $path.'/cac:PostalAddress/cbc:StreetName', $root), 'city' => $this->value($xpath, $path.'/cac:PostalAddress/cbc:CityName', $root), 'district' => $this->value($xpath, $path.'/cac:PostalAddress/cbc:CitySubdivisionName', $root), 'postal_code' => $this->value($xpath, $path.'/cac:PostalAddress/cbc:PostalZone', $root), 'country_code' => $this->value($xpath, $path.'/cac:PostalAddress/cac:Country/cbc:IdentificationCode', $root)],
        ];
    }

    private function value(DOMXPath $xpath, string $path, DOMNode $context): string
    {
        return trim((string) $xpath->evaluate('string('.$path.')', $context));
    }

    private function decimal(string $value): BigDecimal
    {
        try {
            return BigDecimal::of(trim($value));
        } catch (MathException) {
            throw ValidationException::withMessages(['xml' => 'The incoming document contains an invalid monetary value.']);
        }
    }
}
