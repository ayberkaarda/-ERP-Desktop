<?php

declare(strict_types=1);

use App\Modules\Assistant\Services\PrivacyFilter;

beforeEach(function (): void {
    config(['assistant.mask_pii' => true]);
});

it('preserves decimal business values in text and indexed report rows', function (string $number): void {
    $filter = app(PrivacyFilter::class);
    expect($filter->text('Balance: '.$number.' TRY'))->toBe('Balance: '.$number.' TRY');
    expect($filter->data([['local' => $number, 'on_hand' => $number, 'telephone_cost' => $number], [$number]]))->toBe([['local' => $number, 'on_hand' => $number, 'telephone_cost' => $number], [$number]]);
})->with(['1000000.0000', '-1000000.0000', '1234567890123.00', '10000000000.000001', '1000.000000001']);

it('preserves UUIDs and links with entirely numeric UUID suffixes', function (): void {
    $id = '01900000-0000-7000-8000-123456789012';
    $url = '/purchasing/requests/'.$id;
    $filter = app(PrivacyFilter::class);
    expect($filter->text('Record '.$id.': '.$url))->toBe('Record '.$id.': '.$url);
    expect($filter->data(['id' => $id, 'url' => $url]))->toBe(['id' => $id, 'url' => $url]);
});

it('preserves already filtered JSON numeric values and links on repeated audit filtering', function (): void {
    $id = '01900000-0000-7000-8000-123456789012';
    $payload = ['untrusted_data' => ['rows' => [['1000000.0000', '12345678901']], 'debit' => '12345678901', 'url' => '/accounting/journal/'.$id, 'phone' => '0555.1234567', 'empty' => new stdClass]];
    $filter = app(PrivacyFilter::class);
    $once = $filter->data(json_encode($payload, JSON_THROW_ON_ERROR));
    $twice = $filter->data($once);
    $decoded = json_decode($twice, true, flags: JSON_THROW_ON_ERROR);
    expect($decoded['untrusted_data']['rows'][0][0])->toBe('1000000.0000');
    expect($decoded['untrusted_data']['debit'])->toBe('12345678901');
    expect($decoded['untrusted_data']['url'])->toBe('/accounting/journal/'.$id);
    expect($decoded['untrusted_data']['phone'])->toBe('[number]');
    expect($twice)->toBe($once)->toContain('"empty":{}');
});

it('still masks actual contact telephone formats', function (string $phone): void {
    $filter = app(PrivacyFilter::class);
    expect($filter->data(['phone' => $phone, 'mobile_number' => $phone]))->toBe(['phone' => '[number]', 'mobile_number' => '[number]']);
    expect($filter->text('Phone: '.$phone.'; balance 1000000.0000'))->toBe('Phone: [number]; balance 1000000.0000');
})->with(['+90 555 123 45 67', '05551234567', '0555.1234567', '0555-123-45-67']);

it('masks unlabelled grouped phones emails and IBANs while leaving ISO dates intact', function (): void {
    $filter = app(PrivacyFilter::class);
    $text = 'Call +90 555 123 45 67 or a@example.com; TR330006100519786457841326; 2027-06-15T10:30:00Z';
    expect($filter->text($text))->toBe('Call [number] or [email]; [iban]; 2027-06-15T10:30:00Z');
});

it('honors explicit masking opt out for both structured contacts and text', function (): void {
    config(['assistant.mask_pii' => false]);
    $value = ['phone' => '+90 555 123 45 67', 'email' => 'a@example.com'];
    expect(app(PrivacyFilter::class)->data($value))->toBe($value);
    expect(app(PrivacyFilter::class)->text('Call +90 555 123 45 67'))->toBe('Call +90 555 123 45 67');
});
