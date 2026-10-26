<?php

declare(strict_types=1);

use App\Modules\Catalog\Barcodes\Ean13Validator;
use App\Modules\Catalog\Barcodes\Ean8Validator;
use App\Modules\Catalog\Barcodes\GtinValidator;
use App\Modules\Catalog\Barcodes\UpcAValidator;
use App\Modules\Catalog\Enums\BarcodeType;

dataset('valid barcodes', [
    'EAN-13 classic' => [Ean13Validator::class, '4006381333931'],
    'EAN-13 GS1 sample' => [Ean13Validator::class, '5901234123457'],
    'EAN-13 Turkish prefix' => [Ean13Validator::class, '8690000000005'],
    'EAN-13 check digit 0' => [Ean13Validator::class, '0000000000000'],
    'EAN-8 sample' => [Ean8Validator::class, '96385074'],
    'EAN-8 second' => [Ean8Validator::class, '73513537'],
    'UPC-A sample' => [UpcAValidator::class, '036000291452'],
    'UPC-A sequence' => [UpcAValidator::class, '012345678905'],
]);

dataset('invalid barcodes', [
    'EAN-13 wrong check digit' => [Ean13Validator::class, '4006381333932'],
    'EAN-13 too short' => [Ean13Validator::class, '400638133393'],
    'EAN-13 too long' => [Ean13Validator::class, '40063813339310'],
    'EAN-13 letters' => [Ean13Validator::class, '400638133393A'],
    'EAN-13 spaces' => [Ean13Validator::class, '4006381 33393'],
    'EAN-13 trailing newline' => [Ean13Validator::class, "4006381333931\n"],
    'EAN-8 wrong check digit' => [Ean8Validator::class, '96385075'],
    'EAN-8 given an EAN-13' => [Ean8Validator::class, '4006381333931'],
    'UPC-A wrong check digit' => [UpcAValidator::class, '036000291453'],
    'UPC-A given an EAN-13' => [UpcAValidator::class, '0036000291452'],
    'empty' => [Ean13Validator::class, ''],
    // A newline after a full-length payload whose check digit is 0 used to slip through "$".
    'EAN-13 zeros plus newline' => [Ean13Validator::class, "0000000000000\n"],
    'EAN-8 zeros plus newline' => [Ean8Validator::class, "00000000\n"],
    'UPC-A zeros plus newline' => [UpcAValidator::class, "000000000000\n"],
    'EAN-13 valid code plus newline' => [Ean13Validator::class, "5901234123457\n"],
    'EAN-13 unicode digits' => [Ean13Validator::class, '٤006381333931'],
]);

it('accepts barcodes with a correct GS1 check digit', function (string $class, string $barcode): void {
    expect((new $class)->isValid($barcode))->toBeTrue();
})->with('valid barcodes');

it('rejects wrong check digits, lengths and characters', function (string $class, string $barcode): void {
    expect((new $class)->isValid($barcode))->toBeFalse();
})->with('invalid barcodes');

it('computes the mod-10 check digit with weights 3,1 from the right', function (): void {
    expect(GtinValidator::checkDigit('400638133393'))->toBe(1)
        ->and(GtinValidator::checkDigit('9638507'))->toBe(4)
        ->and(GtinValidator::checkDigit('03600029145'))->toBe(2)
        ->and(GtinValidator::checkDigit('000000000000'))->toBe(0)
        ->and(GtinValidator::checkDigit('1'))->toBe(7);
});

it('completes a payload and refuses bad payloads', function (): void {
    expect((new Ean13Validator)->complete('590123412345'))->toBe('5901234123457')
        ->and((new Ean8Validator)->complete('7351353'))->toBe('73513537')
        ->and(fn () => (new Ean13Validator)->complete('123'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => GtinValidator::checkDigit('12a'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => GtinValidator::checkDigit("12\n"))->toThrow(InvalidArgumentException::class);
});

it('maps declared barcode types to their validators', function (): void {
    expect(BarcodeType::Ean13->validator())->toBeInstanceOf(Ean13Validator::class)
        ->and(BarcodeType::Ean8->validator())->toBeInstanceOf(Ean8Validator::class)
        ->and(BarcodeType::UpcA->validator())->toBeInstanceOf(UpcAValidator::class)
        ->and(BarcodeType::Code128->validator())->toBeNull()
        ->and(BarcodeType::Other->validator())->toBeNull();
});
