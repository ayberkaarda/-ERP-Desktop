<?php

declare(strict_types=1);

use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Ubl\DocumentXmlService;
use App\Modules\EDocuments\Validation\SafeXml;
use Brick\Math\BigDecimal;
use Illuminate\Validation\ValidationException;

/** @return array<string, mixed> */
function officialXmlFixture(string $kind = 'e_invoice', string $profile = 'TEMELFATURA'): array
{
    $party = ['tax_number' => '1234567890', 'tax_scheme' => 'VKN', 'name' => 'Deneme Şirketi & Ortakları', 'tax_office' => 'Kadıköy', 'address' => ['street' => 'Test Sokak 1', 'city' => 'İstanbul', 'district' => 'Kadıköy', 'postal_code' => '34710', 'country_code' => 'TR', 'country_name' => 'Türkiye']];
    $customer = [...$party, 'tax_number' => '9876543210', 'name' => 'Alıcı Şirket'];
    $export = $profile === 'IHRACAT';
    if ($export) {
        $customer['tax_number'] = 'DE123456789';
        $customer['address'] = ['street' => 'Teststrasse 1', 'city' => 'Berlin', 'district' => 'Mitte', 'postal_code' => '10115', 'country_code' => 'DE', 'country_name' => 'Germany'];
    }

    return ['kind' => $kind, 'profile' => $profile, 'uuid' => '01900000-0000-7000-8000-123456789012', 'number' => 'ABC2026000000001', 'issue_date' => '2026-10-01', 'issue_time' => '10:00:00', 'currency' => $export ? 'EUR' : 'TRY', 'fx_rate' => '40.000000', 'invoice_type' => $export ? 'ISTISNA' : 'SATIS', 'supplier' => $party, 'customer' => $customer,
        'lines' => [['id' => 'line-1', 'item_code' => 'ITEM-1', 'name' => 'Ürün <one>', 'quantity' => '2.000000', 'unit_code' => 'C62', 'unit_price' => '100.000000', 'net_amount' => '200.0000', 'tax_rate' => $export ? '0' : '20', 'tax_amount' => $export ? '0.0000' : '40.0000', 'total' => $export ? '200.0000' : '240.0000', 'discount_amount' => '0', 'tax_type_code' => '0015']],
        'totals' => ['subtotal' => '200.0000', 'discount' => '0.0000', 'tax' => $export ? '0.0000' : '40.0000', 'total' => $export ? '200.0000' : '240.0000', 'payable' => $export ? '200.0000' : '240.0000'],
        'metadata' => ['payment_iban' => 'TR330006100519786457841326', 'tax_exemption_code' => '301', 'tax_exemption_reason' => 'Mal ihracatı', 'export_delivery_terms' => 'CIF', 'export_transport_mode' => '1', 'export_gtip' => '020622000000', 'export_package_type' => 'CN', 'export_package_quantity' => '1', 'export_package_id' => 'PKG-1', 'actual_despatch_date' => '2026-10-01', 'actual_despatch_time' => '11:00:00', 'driver_first_name' => 'Ali', 'driver_last_name' => 'Yılmaz', 'driver_tax_number' => '12345678901', 'vehicle_plate' => '34ABC123']];
}

it('selects the unique tax identity rather than an auxiliary party identifier', function (): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    $xml = str_replace('<cac:PartyIdentification>', '<cac:PartyIdentification><cbc:ID schemeID="MERSISNO">1234567890123456</cbc:ID></cac:PartyIdentification><cac:PartyIdentification>', $xml);
    expect($service->validate($xml, 'e_invoice')->valid)->toBeTrue();
    expect($service->parse($xml)->toArray()['customer']['tax_number'])->toBe('9876543210');
    $xml = str_replace('schemeID="MERSISNO"', 'schemeID="VKN"', $xml);
    expect(fn () => $service->parse($xml))->toThrow(ValidationException::class);
});

it('rejects inconsistent supported line values despite genuine official structural acceptance', function (string $mutation): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    $xml = match ($mutation) {
        'price' => preg_replace('/(<cbc:PriceAmount currencyID="TRY">)[^<]+/', '${1}999', $xml),
        'rate' => str_replace('<cbc:Percent>20</cbc:Percent>', '<cbc:Percent>10</cbc:Percent>', $xml),
        'base' => str_replace('</cac:Price>', '<cbc:BaseQuantity unitCode="C62">2</cbc:BaseQuantity></cac:Price>', $xml),
    };
    $result = $service->validate($xml, 'e_invoice');
    expect($result->valid)->toBeFalse();
    if ($mutation !== 'base') {
        expect($result->metadata['xsd_valid'])->toBeTrue()->and($result->metadata['schematron_valid'])->toBeTrue();
        expect(array_column($result->errors, 'code'))->toContain('UNSUPPORTED_OR_INCONSISTENT_INVOICE');
    }
    expect(fn () => $service->parse($xml))->toThrow(ValidationException::class);
})->with(['price', 'rate', 'base']);

it('fails closed for header withholding instead of discarding the breakdown', function (): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    $xml = str_replace('<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>', '<cbc:InvoiceTypeCode>TEVKIFAT</cbc:InvoiceTypeCode>', $xml);
    $withholding = '<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">16.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">40.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">16.00</cbc:TaxAmount><cbc:Percent>40</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV TEVKIFAT</cbc:Name><cbc:TaxTypeCode>601</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:WithholdingTaxTotal>';
    $xml = str_replace('<cac:LegalMonetaryTotal>', $withholding.'<cac:LegalMonetaryTotal>', $xml);
    $xml = str_replace('<cbc:PayableAmount currencyID="TRY">240.00</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="TRY">224.00</cbc:PayableAmount>', $xml);
    $result = $service->validate($xml, 'e_invoice');
    expect($result->metadata['xsd_valid'])->toBeTrue()->and($result->metadata['schematron_valid'])->toBeTrue()->and($result->valid)->toBeFalse();
    expect(fn () => $service->parse($xml))->toThrow(ValidationException::class);
});

it('generates documents passing the complete pinned official XSD and Schematron', function (string $kind, string $profile): void {
    $service = app(DocumentXmlService::class);
    expect($service->available())->toBeTrue();
    $snapshot = officialXmlFixture($kind, $profile);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray($snapshot));
    $result = $service->validate($xml, $kind);
    expect($result->available)->toBeTrue()->and($result->errors)->toBe([])->and($result->valid)->toBeTrue();
    expect($result->metadata)->toMatchArray(['xsd_valid' => true, 'schematron_valid' => true, 'signature_verified' => false]);
    expect($xml)->not->toContain('<ds:Signature')->toContain('UnsignedSandbox', '&amp;', '&lt;one&gt;');
    $parsed = $service->parse($xml)->toArray();
    expect($parsed['kind'])->toBe($kind)->and($parsed['number'])->toBe($snapshot['number'])->and($parsed['lines'][0]['name'])->toBe('Ürün <one>');
})->with([
    ['e_invoice', 'TEMELFATURA'], ['e_invoice', 'TICARIFATURA'], ['e_invoice', 'IHRACAT'], ['e_invoice', 'KAMU'], ['e_archive', 'EARSIVFATURA'], ['e_despatch', 'TEMELIRSALIYE'],
]);

it('reports genuine Schematron failures when XSD remains valid', function (): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    $xml = str_replace('ABC2026000000001', 'INVALID', $xml);
    $result = $service->validate($xml, 'e_invoice');
    expect($result->available)->toBeTrue()->and($result->valid)->toBeFalse()->and($result->metadata['xsd_valid'])->toBeTrue();
    expect(array_column($result->errors, 'layer'))->toContain('schematron');
});

it('rejects XSD-invalid documents without pretending the business rules passed', function (): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    $xml = str_replace('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>', '', $xml);
    $result = $service->validate($xml, 'e_invoice');
    expect($result->valid)->toBeFalse()->and($result->metadata['xsd_valid'])->toBeFalse()->and($result->metadata['schematron_valid'])->toBeNull();
});

it('never changes source monetary values to manufacture cent-representable totals', function (): void {
    $snapshot = officialXmlFixture();
    $snapshot['totals']['total'] = '240.0001';
    expect(fn () => app(DocumentXmlService::class)->generate(XmlDocumentSnapshot::fromArray($snapshot)))->toThrow(ValidationException::class);
});

it('requires profile-specific metadata instead of manufacturing export public-sector or transport details', function (string $kind, string $profile, string $missing): void {
    $snapshot = officialXmlFixture($kind, $profile);
    unset($snapshot['metadata'][$missing]);
    expect(fn () => app(DocumentXmlService::class)->generate(XmlDocumentSnapshot::fromArray($snapshot)))->toThrow(ValidationException::class);
})->with([['e_invoice', 'IHRACAT', 'export_gtip'], ['e_invoice', 'KAMU', 'payment_iban'], ['e_despatch', 'TEMELIRSALIYE', 'driver_tax_number']]);

it('rejects entity declarations and excessive structures including encoded input', function (): void {
    $dangerous = '<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]><Invoice>&x;</Invoice>';
    $safe = app(SafeXml::class);
    expect(fn () => $safe->load($dangerous))->toThrow(ValidationException::class);
    expect(fn () => $safe->load(mb_convert_encoding($dangerous, 'UTF-16LE', 'UTF-8')))->toThrow(ValidationException::class);
    expect(fn () => $safe->load(str_repeat('<x>', 65).str_repeat('</x>', 65)))->toThrow(ValidationException::class);
    expect(fn () => $safe->load('<x>'.str_repeat('a', 2 * 1024 * 1024).'</x>'))->toThrow(ValidationException::class);
});

it('fails closed when the runtime is unavailable and rejects mismatched kinds', function (): void {
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray(officialXmlFixture()));
    config(['edocuments.java_binary' => 'missing-java-executable']);
    expect($service->available())->toBeFalse();
    $result = $service->validate($xml, 'e_invoice');
    expect($result->available)->toBeFalse()->and($result->valid)->toBeFalse();
    expect($service->validate($xml, 'e_despatch')->valid)->toBeFalse();
});

it('preserves line allowances without subtracting them twice from legal totals', function (): void {
    $snapshot = officialXmlFixture();
    $snapshot['lines'][0]['discount_amount'] = '20.0000';
    $snapshot['lines'][0]['net_amount'] = '180.0000';
    $snapshot['lines'][0]['tax_amount'] = '36.0000';
    $snapshot['lines'][0]['total'] = '216.0000';
    $snapshot['totals'] = ['subtotal' => '200.0000', 'discount' => '20.0000', 'tax' => '36.0000', 'total' => '216.0000', 'payable' => '216.0000'];
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray($snapshot));
    expect($xml)->toContain('<cbc:LineExtensionAmount currencyID="TRY">180.00</cbc:LineExtensionAmount>');
    expect($service->validate($xml, 'e_invoice')->errors)->toBe([]);
    $parsed = $service->parse($xml)->toArray();
    expect((string) BigDecimal::of($parsed['totals']['subtotal'])->toScale(2))->toBe('200.00');
    expect((string) BigDecimal::of($parsed['totals']['discount'])->toScale(2))->toBe('20.00');
});

it('converts a tax-inclusive source unit price to an exact exclusive representation without repricing', function (): void {
    $snapshot = officialXmlFixture();
    $snapshot['lines'][0]['tax_inclusive'] = true;
    $snapshot['lines'][0]['unit_price'] = '120.000000';
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray($snapshot));
    expect($xml)->toContain('<cbc:PriceAmount currencyID="TRY">100</cbc:PriceAmount>');
    expect($service->validate($xml, 'e_invoice')->errors)->toBe([]);
});

it('reconciles header VAT from cent-rounded lines rather than imposing aggregate rounding', function (): void {
    $snapshot = officialXmlFixture();
    $line = $snapshot['lines'][0];
    $line = [...$line, 'quantity' => '1', 'unit_price' => '0.03', 'net_amount' => '0.03', 'tax_amount' => '0.01', 'total' => '0.04'];
    $snapshot['lines'] = [$line, [...$line, 'id' => 'line-2']];
    $snapshot['totals'] = ['subtotal' => '0.06', 'discount' => '0', 'tax' => '0.02', 'total' => '0.08', 'payable' => '0.08'];
    $service = app(DocumentXmlService::class);
    $xml = $service->generate(XmlDocumentSnapshot::fromArray($snapshot));
    expect($service->validate($xml, 'e_invoice')->errors)->toBe([]);
    expect($service->parse($xml)->toArray()['totals']['tax'])->toBe('0.02');
});

it('rejects arithmetic inconsistencies even if the official structural rules accept their format', function (): void {
    $snapshot = officialXmlFixture();
    $snapshot['totals']['total'] = '250.00';
    $snapshot['totals']['payable'] = '250.00';
    $service = app(DocumentXmlService::class);
    $result = $service->validate($service->generate(XmlDocumentSnapshot::fromArray($snapshot)), 'e_invoice');
    expect($result->valid)->toBeFalse()->and($result->metadata['xsd_valid'])->toBeTrue()->and($result->metadata['schematron_valid'])->toBeTrue();
    expect(array_column($result->errors, 'code'))->toContain('GROSS_TOTAL_MISMATCH');
});

it('rejects future issue dates using the official rule rather than a handwritten substitute', function (): void {
    $snapshot = officialXmlFixture();
    $snapshot['issue_date'] = '2099-01-01';
    $service = app(DocumentXmlService::class);
    $result = $service->validate($service->generate(XmlDocumentSnapshot::fromArray($snapshot)), 'e_invoice');
    expect($result->valid)->toBeFalse()->and(array_column($result->errors, 'layer'))->toContain('schematron');
});

it('does not process XInclude or stylesheet processing instructions', function (): void {
    $document = app(SafeXml::class)->load('<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="http://127.0.0.1/secret"?><root xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd" parse="text"/></root>');
    expect($document->documentElement?->textContent)->toBe('');
});

it('maps custom local units before checking the official unit format without mutating the source snapshot', function (): void {
    $source = officialXmlFixture();
    $source['lines'][0]['unit_code'] = 'PCSBSZ7';
    $service = app(DocumentXmlService::class);
    expect(fn () => $service->generate(XmlDocumentSnapshot::fromArray($source)))->toThrow(ValidationException::class);
    $source['metadata']['unit_codes'] = ['PCSBSZ7' => 'C62'];
    $snapshot = XmlDocumentSnapshot::fromArray($source);
    $xml = $service->generate($snapshot);
    expect($xml)->toContain('unitCode="C62"')->and($service->validate($xml, 'e_invoice')->errors)->toBe([]);
    expect($snapshot->toArray()['lines'][0]['unit_code'])->toBe('PCSBSZ7');
});
