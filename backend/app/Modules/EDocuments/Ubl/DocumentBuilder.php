<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Ubl;

use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use DOMDocument;
use DOMElement;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class DocumentBuilder
{
    /** @param array<string, mixed> $data */
    public function build(array $data): string
    {
        $data = $this->effectiveUnits($data);
        $this->validate($data);
        $despatch = $data['kind'] === 'e_despatch';
        $doc = new DOMDocument('1.0', 'UTF-8');
        $doc->formatOutput = true;
        $root = $doc->createElementNS($despatch ? XmlNamespaces::DESPATCH : XmlNamespaces::INVOICE, $despatch ? 'DespatchAdvice' : 'Invoice');
        $doc->appendChild($root);
        foreach (['cac' => XmlNamespaces::CAC, 'cbc' => XmlNamespaces::CBC, 'ext' => XmlNamespaces::EXT, 'xsi' => XmlNamespaces::XSI] as $prefix => $uri) {
            $root->setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:'.$prefix, $uri);
        }
        $extension = $this->node($this->node($this->node($root, 'ext:UBLExtensions'), 'ext:UBLExtension'), 'ext:ExtensionContent');
        $marker = $doc->createElementNS(XmlNamespaces::SANDBOX, 'ks:UnsignedSandbox');
        $marker->setAttribute('Id', 'unsigned-sandbox');
        $marker->appendChild($doc->createTextNode('Unsigned sandbox document; no qualified electronic signature.'));
        $extension->appendChild($marker);
        $this->node($root, 'cbc:UBLVersionID', '2.1');
        $this->node($root, 'cbc:CustomizationID', 'TR1.2.1');
        $this->node($root, 'cbc:ProfileID', $data['profile']);
        $this->node($root, 'cbc:ID', $data['number']);
        $this->node($root, 'cbc:CopyIndicator', 'false');
        $this->node($root, 'cbc:UUID', $data['uuid']);
        $this->node($root, 'cbc:IssueDate', $data['issue_date']);
        $this->node($root, 'cbc:IssueTime', $data['issue_time']);
        $this->node($root, $despatch ? 'cbc:DespatchAdviceTypeCode' : 'cbc:InvoiceTypeCode', $despatch ? 'SEVK' : (string) ($data['invoice_type'] ?? 'SATIS'));
        $this->node($root, 'cbc:Note', 'SANDBOX — unsigned document, not a legal electronic submission.');
        if (! $despatch) {
            $this->node($root, 'cbc:DocumentCurrencyCode', $data['currency']);
        }
        $this->node($root, 'cbc:LineCountNumeric', (string) count($data['lines']));
        if (! $despatch && ($data['invoice_type'] ?? 'SATIS') === 'IADE') {
            $reference = $this->node($this->node($root, 'cac:BillingReference'), 'cac:InvoiceDocumentReference');
            $this->node($reference, 'cbc:ID', (string) $data['metadata']['original_invoice_number']);
            $this->node($reference, 'cbc:IssueDate', (string) $data['metadata']['original_invoice_date']);
            $this->node($reference, 'cbc:DocumentTypeCode', 'IADE');
        }
        $this->signatureDeclaration($root, $data['supplier']);
        $this->party($this->node($root, $despatch ? 'cac:DespatchSupplierParty' : 'cac:AccountingSupplierParty'), $data['supplier']);
        $customer = $data['customer'];
        if ($data['profile'] === 'IHRACAT') {
            $customer = ['tax_number' => '1460415308', 'tax_scheme' => 'VKN', 'name' => 'Gümrük ve Ticaret Bakanlığı', 'tax_office' => 'Ulus', 'address' => ['city' => 'Ankara', 'district' => 'Altındağ', 'country_code' => 'TR', 'country_name' => 'Türkiye', 'street' => '', 'postal_code' => '06050']];
        }
        $this->party($this->node($root, $despatch ? 'cac:DeliveryCustomerParty' : 'cac:AccountingCustomerParty'), $customer);
        if ($data['profile'] === 'IHRACAT') {
            $this->party($this->node($root, 'cac:BuyerCustomerParty'), $data['customer'], true);
        }
        if ($despatch) {
            $this->shipment($root, $data['metadata'], $data['customer']);
            foreach ($data['lines'] as $index => $line) {
                $element = $this->node($root, 'cac:DespatchLine');
                $this->node($element, 'cbc:ID', (string) ($index + 1));
                $this->node($element, 'cbc:DeliveredQuantity', (string) $line['quantity'], ['unitCode' => (string) $line['unit_code']]);
                $order = $this->node($element, 'cac:OrderLineReference');
                $this->node($order, 'cbc:LineID', (string) ($index + 1));
                $this->item($element, $line);
            }
        } else {
            if ($data['profile'] === 'KAMU') {
                $payment = $this->node($root, 'cac:PaymentMeans');
                $this->node($payment, 'cbc:PaymentMeansCode', '42');
                $this->node($this->node($payment, 'cac:PayeeFinancialAccount'), 'cbc:ID', (string) $data['metadata']['payment_iban']);
            }
            $this->invoiceAmounts($root, $data);
        }

        return (string) $doc->saveXML();
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function effectiveUnits(array $data): array
    {
        $map = $data['metadata']['unit_codes'] ?? [];
        if (! is_array($map) || count($map) > 500) {
            throw ValidationException::withMessages(['metadata.unit_codes' => 'The unit mapping must be a bounded object.']);
        }
        foreach ($map as $code) {
            if (! is_string($code) || preg_match('/^[A-Z0-9]{1,6}$/', $code) !== 1) {
                throw ValidationException::withMessages(['metadata.unit_codes' => 'Mapped units must be official unit codes.']);
            }
        }
        if (is_array($data['lines'] ?? null)) {
            foreach ($data['lines'] as $index => $line) {
                if (is_array($line) && is_string($line['unit_code'] ?? null) && isset($map[$line['unit_code']])) {
                    $data['lines'][$index]['source_unit_code'] = $line['unit_code'];
                    $data['lines'][$index]['unit_code'] = $map[$line['unit_code']];
                }
            }
        }

        return $data;
    }

    /** @param array<string, mixed> $data */
    private function validate(array $data): void
    {
        $rules = [
            'kind' => ['required', 'in:e_invoice,e_archive,e_despatch'], 'profile' => ['required', 'string'],
            'uuid' => ['required', 'uuid'], 'number' => ['required', 'regex:/^[A-Z0-9]{3}20\d{2}\d{9}$/'],
            'issue_date' => ['required', 'date_format:Y-m-d'], 'issue_time' => ['required', 'date_format:H:i:s'],
            'currency' => ['required', 'regex:/^[A-Z]{3}$/'], 'lines' => ['required', 'array', 'min:1', 'max:500'], 'metadata' => ['present', 'array'],
            'lines.*.id' => ['required', 'string', 'max:100'], 'lines.*.name' => ['required', 'string', 'max:500'], 'lines.*.item_code' => ['required', 'string', 'max:100'],
            'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,8})?$/'], 'lines.*.unit_code' => ['required', 'regex:/^[A-Z0-9]{1,6}$/'],
        ];
        foreach (['supplier', 'customer'] as $party) {
            $rules[$party] = ['required', 'array'];
            $rules[$party.'.name'] = ['required', 'string', 'max:250'];
            $rules[$party.'.tax_number'] = ['required', 'string', 'max:32'];
            $rules[$party.'.address.city'] = ['required', 'string', 'max:100'];
            $rules[$party.'.address.district'] = ['required', 'string', 'max:100'];
            $rules[$party.'.address.country_code'] = ['required', 'regex:/^[A-Z]{2}$/'];
        }
        Validator::make($data, $rules)->validate();
        $kind = (string) $data['kind'];
        $profile = (string) $data['profile'];
        if (! in_array($profile, match ($kind) {
            'e_invoice' => ['TEMELFATURA', 'TICARIFATURA', 'IHRACAT', 'KAMU'], 'e_archive' => ['EARSIVFATURA'], default => ['TEMELIRSALIYE']
        }, true)) {
            throw ValidationException::withMessages(['profile' => 'The profile is incompatible with this document kind.']);
        }
        if (($data['invoice_type'] ?? 'SATIS') === 'IADE') {
            Validator::make($data, ['metadata.original_invoice_number' => ['required', 'string', 'max:100'], 'metadata.original_invoice_date' => ['required', 'date_format:Y-m-d']])->validate();
        } elseif (! in_array($data['invoice_type'] ?? 'SATIS', ['SATIS', 'ISTISNA'], true) && $kind !== 'e_despatch') {
            throw ValidationException::withMessages(['invoice_type' => 'This invoice tax scenario is not supported by the XML mapper.']);
        }
        foreach ($data['lines'] as $index => $line) {
            if (BigDecimal::of((string) $line['quantity'])->isLessThanOrEqualTo(0)) {
                throw ValidationException::withMessages(['lines.'.$index.'.quantity' => 'Quantity must be positive.']);
            }
            if ($kind !== 'e_despatch' && ($line['tax_type_code'] ?? '0015') !== '0015') {
                throw ValidationException::withMessages(['lines.'.$index.'.tax_type_code' => 'Only a single VAT component is currently supported; other tax components cannot be discarded.']);
            }
        }
        if ($kind !== 'e_despatch' && ($data['currency'] ?? 'TRY') !== 'TRY') {
            Validator::make($data, ['fx_rate' => ['required', 'string', 'regex:/^\d{1,14}(\.\d{1,6})?$/', 'numeric', 'gt:0']])->validate();
        }
        if ($profile === 'KAMU') {
            Validator::make($data, ['metadata.payment_iban' => ['required', 'regex:/^TR\d{7}[A-Z0-9]{17}$/']])->validate();
        }
        if ($profile === 'IHRACAT') {
            Validator::make($data, ['metadata.export_delivery_terms' => ['required', 'in:EXW,FCA,CPT,CIP,DAP,DPU,DDP,FAS,FOB,CFR,CIF'], 'metadata.export_transport_mode' => ['required', 'in:1,2,3,4,5,7,8,9'], 'metadata.export_package_type' => ['required', 'regex:/^[A-Z0-9]{2}$/'], 'metadata.export_package_quantity' => ['required', 'numeric', 'gt:0'], 'metadata.export_package_id' => ['required', 'string', 'max:50']])->validate();
            foreach ($data['lines'] as $index => $line) {
                $gtip = $data['metadata']['export_gtip_codes'][(string) $line['id']] ?? $data['metadata']['export_gtip'] ?? '';
                if (! is_string($gtip) || preg_match('/^\d{12}$/', $gtip) !== 1) {
                    throw ValidationException::withMessages(['metadata.export_gtip_codes.'.$index => 'A twelve digit GTIP code is required for every export line.']);
                }
            }
        }
        if ($kind === 'e_despatch') {
            Validator::make($data, ['metadata.actual_despatch_date' => ['required', 'date_format:Y-m-d'], 'metadata.actual_despatch_time' => ['required', 'date_format:H:i:s'], 'metadata.driver_first_name' => ['required', 'string', 'max:100'], 'metadata.driver_last_name' => ['required', 'string', 'max:100'], 'metadata.driver_tax_number' => ['required', 'regex:/^\d{11}$/'], 'metadata.vehicle_plate' => ['required', 'regex:/^(0[1-9]|[1-7][0-9]|8[01])[A-Z]+\d+$/']])->validate();
            $address = $data['metadata']['delivery_address'] ?? $data['customer']['address'];
            Validator::make($address, ['city' => ['required', 'string'], 'district' => ['required', 'string'], 'postal_code' => ['required', 'regex:/^(0[1-9]|[1-7][0-9]|8[01])\d{3}$/'], 'country_code' => ['required', 'string']])->validate();
        }
    }

    /** @param array<string, mixed> $data */
    private function invoiceAmounts(DOMElement $root, array $data): void
    {
        $currency = (string) $data['currency'];
        if ($currency !== 'TRY') {
            $exchange = $this->node($root, 'cac:PricingExchangeRate');
            $this->node($exchange, 'cbc:SourceCurrencyCode', $currency);
            $this->node($exchange, 'cbc:TargetCurrencyCode', 'TRY');
            $this->node($exchange, 'cbc:CalculationRate', (string) $data['fx_rate']);
        }
        $groups = [];
        foreach ($data['lines'] as $line) {
            $rate = (string) $line['tax_rate'];
            $groups[$rate] ??= ['net' => BigDecimal::zero(), 'tax' => BigDecimal::zero(), 'exemption' => $line['tax_exemption_code'] ?? $data['metadata']['tax_exemption_code'] ?? null];
            $groups[$rate]['net'] = $groups[$rate]['net']->plus((string) $line['net_amount']);
            $groups[$rate]['tax'] = $groups[$rate]['tax']->plus((string) $line['tax_amount']);
        }
        $tax = $this->node($root, 'cac:TaxTotal');
        $this->money($tax, 'cbc:TaxAmount', (string) $data['totals']['tax'], $currency);
        foreach ($groups as $rate => $group) {
            $this->taxSubtotal($tax, (string) $group['net'], (string) $group['tax'], (string) $rate, $currency, $group['exemption'], $data['metadata']['tax_exemption_reason'] ?? null);
        }
        $total = $this->node($root, 'cac:LegalMonetaryTotal');
        $net = $this->sum($data['lines'], 'net_amount');
        $this->money($total, 'cbc:LineExtensionAmount', $net, $currency, true);
        $this->money($total, 'cbc:TaxExclusiveAmount', $net, $currency, true);
        $this->money($total, 'cbc:TaxInclusiveAmount', (string) $data['totals']['total'], $currency, true);
        $this->money($total, 'cbc:PayableAmount', (string) $data['totals']['payable'], $currency, true);
        foreach ($data['lines'] as $index => $line) {
            $element = $this->node($root, 'cac:InvoiceLine');
            $this->node($element, 'cbc:ID', (string) ($index + 1));
            $this->node($element, 'cbc:InvoicedQuantity', (string) $line['quantity'], ['unitCode' => (string) $line['unit_code']]);
            $this->money($element, 'cbc:LineExtensionAmount', (string) $line['net_amount'], $currency);
            if ($data['profile'] === 'IHRACAT') {
                $this->exportDelivery($element, $data, $line);
            }
            if (BigDecimal::of((string) ($line['discount_amount'] ?? '0'))->isGreaterThan(0)) {
                $allowance = $this->node($element, 'cac:AllowanceCharge');
                $this->node($allowance, 'cbc:ChargeIndicator', 'false');
                $this->money($allowance, 'cbc:Amount', (string) $line['discount_amount'], $currency);
            }
            $lineTax = $this->node($element, 'cac:TaxTotal');
            $this->money($lineTax, 'cbc:TaxAmount', (string) $line['tax_amount'], $currency);
            $this->taxSubtotal($lineTax, (string) $line['net_amount'], (string) $line['tax_amount'], (string) $line['tax_rate'], $currency, $line['tax_exemption_code'] ?? $data['metadata']['tax_exemption_code'] ?? null, $data['metadata']['tax_exemption_reason'] ?? null);
            $this->item($element, $line);
            $unitPrice = (string) $line['unit_price'];
            if (($line['tax_inclusive'] ?? false) === true) {
                try {
                    $unitPrice = (string) BigDecimal::of((string) $line['net_amount'])->plus((string) ($line['discount_amount'] ?? '0'))->dividedBy((string) $line['quantity'], 6)->strippedOfTrailingZeros();
                } catch (MathException) {
                    throw ValidationException::withMessages(['lines' => 'The tax-exclusive source unit price cannot be represented without rounding.']);
                }
            }
            $this->node($this->node($element, 'cac:Price'), 'cbc:PriceAmount', $unitPrice, ['currencyID' => $currency]);
        }
    }

    private function taxSubtotal(DOMElement $parent, string $net, string $tax, string $rate, string $currency, mixed $exemption, mixed $reason): void
    {
        $subtotal = $this->node($parent, 'cac:TaxSubtotal');
        $this->money($subtotal, 'cbc:TaxableAmount', $net, $currency);
        $this->money($subtotal, 'cbc:TaxAmount', $tax, $currency);
        $this->node($subtotal, 'cbc:CalculationSequenceNumeric', '1');
        $this->node($subtotal, 'cbc:Percent', $rate);
        $category = $this->node($subtotal, 'cac:TaxCategory');
        if (BigDecimal::of($rate)->isZero()) {
            if (! is_string($exemption) || $exemption === '' || ! is_string($reason) || $reason === '') {
                throw ValidationException::withMessages(['metadata.tax_exemption_code' => 'Zero-rated VAT requires an explicit official exemption code and reason.']);
            }
            $this->node($category, 'cbc:TaxExemptionReasonCode', $exemption);
            $this->node($category, 'cbc:TaxExemptionReason', $reason);
        }
        $scheme = $this->node($category, 'cac:TaxScheme');
        $this->node($scheme, 'cbc:Name', 'KDV');
        $this->node($scheme, 'cbc:TaxTypeCode', '0015');
    }

    /** @param array<string, mixed> $party */
    private function signatureDeclaration(DOMElement $root, array $party): void
    {
        $signature = $this->node($root, 'cac:Signature');
        $this->node($signature, 'cbc:ID', (string) $party['tax_number'], ['schemeID' => 'VKN_TCKN']);
        $this->party($signature, $party, false, 'cac:SignatoryParty');
        $this->node($this->node($this->node($signature, 'cac:DigitalSignatureAttachment'), 'cac:ExternalReference'), 'cbc:URI', '#unsigned-sandbox');
    }

    /** @param array<string, mixed> $data */
    private function party(DOMElement $parent, array $data, bool $export = false, string $name = 'cac:Party'): void
    {
        $party = $this->node($parent, $name);
        $scheme = $export ? 'PARTYTYPE' : (strlen((string) $data['tax_number']) === 11 ? 'TCKN' : 'VKN');
        $this->node($this->node($party, 'cac:PartyIdentification'), 'cbc:ID', $export ? 'EXPORT' : (string) $data['tax_number'], ['schemeID' => $scheme]);
        $this->node($this->node($party, 'cac:PartyName'), 'cbc:Name', (string) $data['name']);
        $this->address($this->node($party, 'cac:PostalAddress'), $data['address']);
        if (! $export) {
            $this->node($this->node($this->node($party, 'cac:PartyTaxScheme'), 'cac:TaxScheme'), 'cbc:Name', (string) ($data['tax_office'] ?? ''));
        } else {
            $entity = $this->node($party, 'cac:PartyLegalEntity');
            $this->node($entity, 'cbc:RegistrationName', (string) $data['name']);
            $this->node($entity, 'cbc:CompanyID', (string) $data['tax_number']);
        }
        if ($scheme === 'TCKN') {
            $person = $this->node($party, 'cac:Person');
            $this->node($person, 'cbc:FirstName', (string) ($data['first_name'] ?? $data['name']));
            $this->node($person, 'cbc:FamilyName', (string) ($data['last_name'] ?? $data['name']));
        }
    }

    /** @param array<string, mixed> $data */
    private function address(DOMElement $parent, array $data): void
    {
        $this->node($parent, 'cbc:StreetName', (string) ($data['street'] ?? ''));
        $this->node($parent, 'cbc:CitySubdivisionName', (string) ($data['district'] ?? ''));
        $this->node($parent, 'cbc:CityName', (string) ($data['city'] ?? ''));
        if (! empty($data['postal_code'])) {
            $this->node($parent, 'cbc:PostalZone', (string) $data['postal_code']);
        }
        $country = $this->node($parent, 'cac:Country');
        $this->node($country, 'cbc:IdentificationCode', (string) ($data['country_code'] ?? ''));
        $this->node($country, 'cbc:Name', (string) ($data['country_name'] ?? $data['country_code'] ?? ''));
    }

    /** @param array<string, mixed> $line */
    private function item(DOMElement $parent, array $line): void
    {
        $item = $this->node($parent, 'cac:Item');
        $this->node($item, 'cbc:Name', (string) $line['name']);
        $this->node($this->node($item, 'cac:SellersItemIdentification'), 'cbc:ID', (string) $line['item_code']);
    }

    /** @param array<string, mixed> $metadata
     * @param  array<string, mixed>  $customer
     */
    private function shipment(DOMElement $root, array $metadata, array $customer): void
    {
        $shipment = $this->node($root, 'cac:Shipment');
        $this->node($shipment, 'cbc:ID', '1');
        $stage = $this->node($shipment, 'cac:ShipmentStage');
        $this->node($this->node($this->node($stage, 'cac:TransportMeans'), 'cac:RoadTransport'), 'cbc:LicensePlateID', (string) $metadata['vehicle_plate'], ['schemeID' => 'PLAKA']);
        $driver = $this->node($stage, 'cac:DriverPerson');
        $this->node($driver, 'cbc:FirstName', (string) $metadata['driver_first_name']);
        $this->node($driver, 'cbc:FamilyName', (string) $metadata['driver_last_name']);
        $this->node($driver, 'cbc:NationalityID', (string) $metadata['driver_tax_number']);
        $delivery = $this->node($shipment, 'cac:Delivery');
        $this->address($this->node($delivery, 'cac:DeliveryAddress'), $metadata['delivery_address'] ?? $customer['address']);
        $despatch = $this->node($delivery, 'cac:Despatch');
        $this->node($despatch, 'cbc:ActualDespatchDate', (string) $metadata['actual_despatch_date']);
        $this->node($despatch, 'cbc:ActualDespatchTime', (string) $metadata['actual_despatch_time']);
    }

    /** @param array<string, mixed> $data
     * @param  array<string, mixed>  $line
     */
    private function exportDelivery(DOMElement $parent, array $data, array $line): void
    {
        $meta = $data['metadata'];
        $delivery = $this->node($parent, 'cac:Delivery');
        $this->address($this->node($delivery, 'cac:DeliveryAddress'), $meta['export_delivery_address'] ?? $data['customer']['address']);
        $this->node($this->node($delivery, 'cac:DeliveryTerms'), 'cbc:ID', (string) $meta['export_delivery_terms'], ['schemeID' => 'INCOTERMS']);
        $shipment = $this->node($delivery, 'cac:Shipment');
        $this->node($shipment, 'cbc:ID', '1');
        $this->node($this->node($shipment, 'cac:GoodsItem'), 'cbc:RequiredCustomsID', (string) ($meta['export_gtip_codes'][(string) $line['id']] ?? $meta['export_gtip']));
        $this->node($this->node($shipment, 'cac:ShipmentStage'), 'cbc:TransportModeCode', (string) $meta['export_transport_mode']);
        $package = $this->node($this->node($shipment, 'cac:TransportHandlingUnit'), 'cac:ActualPackage');
        $this->node($package, 'cbc:ID', (string) $meta['export_package_id']);
        $this->node($package, 'cbc:Quantity', (string) $meta['export_package_quantity']);
        $this->node($package, 'cbc:PackagingTypeCode', (string) $meta['export_package_type']);
    }

    /** @param list<array<string,mixed>> $lines */
    private function sum(array $lines, string $field): string
    {
        $sum = BigDecimal::zero();
        foreach ($lines as $line) {
            $sum = $sum->plus((string) $line[$field]);
        }

        return (string) $sum;
    }

    private function money(DOMElement $parent, string $name, string $value, string $currency, bool $cents = false): void
    {
        try {
            $amount = $cents ? BigDecimal::of($value)->toScale(2) : BigDecimal::of($value)->strippedOfTrailingZeros();
        } catch (MathException) {
            throw ValidationException::withMessages(['amounts' => 'Source monetary values must be representable in cents without changing their value.']);
        }
        $this->node($parent, $name, (string) $amount, ['currencyID' => $currency]);
    }

    /** @param array<string, string> $attributes */
    private function node(DOMElement $parent, string $name, ?string $value = null, array $attributes = []): DOMElement
    {
        $namespace = match (explode(':', $name)[0]) {
            'cbc' => XmlNamespaces::CBC, 'ext' => XmlNamespaces::EXT, default => XmlNamespaces::CAC
        };
        $document = $parent->ownerDocument;
        if (! $document instanceof DOMDocument) {
            throw new \LogicException('An XML element must belong to the document being generated.');
        }
        $node = $document->createElementNS($namespace, $name);
        if ($value !== null) {
            $node->appendChild($document->createTextNode($value));
        }
        foreach ($attributes as $attribute => $text) {
            $node->setAttribute($attribute, $text);
        }
        $parent->appendChild($node);

        return $node;
    }
}
