<?php

declare(strict_types=1);

use App\Modules\Parties\Enums\PartyType;
use App\Modules\Parties\Validation\Iban;
use App\Modules\Parties\Validation\TaxNumber;
use App\Modules\Parties\Validation\Tckn;
use App\Modules\Parties\Validation\Vkn;

describe('VKN', function (): void {
    it('accepts numbers whose check digit matches', function (string $vkn): void {
        expect(Vkn::isValid($vkn))->toBeTrue();
    })->with([
        '1234567890', '4840847211', '0123456789', '0000000001', '9999999994', '0100000007', '5234567895',
    ]);

    it('rejects a wrong check digit', function (string $vkn): void {
        expect(Vkn::isValid($vkn))->toBeFalse();
    })->with([
        '1234567891', '4840847212', '0000000000', '9999999999', '1111111111', '0123456780',
    ]);

    it('rejects anything that is not exactly ten digits', function (string $vkn): void {
        expect(Vkn::isValid($vkn))->toBeFalse();
    })->with([
        '', '123456789', '12345678901', '123456789O', ' 1234567890', '1234567890 ', '12345-7890', '١٢٣٤٥٦٧٨٩٠',
    ]);

    it('computes check digits, including the t = 9 and t = 0 branches', function (): void {
        // 000000000 gives t = 9 at position 1; 123456789 gives t = 0 at every position.
        expect(Vkn::checkDigit('123456789'))->toBe(0)
            ->and(Vkn::checkDigit('999999999'))->toBe(4)
            ->and(Vkn::checkDigit('000000000'))->toBe(1)
            ->and(fn () => Vkn::checkDigit('12345678'))->toThrow(InvalidArgumentException::class);
    });

    it('agrees with isValid for every check digit of a prefix', function (): void {
        $valid = array_filter(range(0, 9), fn (int $d): bool => Vkn::isValid('484084721'.$d));

        expect(array_values($valid))->toBe([1]);
    });
});

describe('TCKN', function (): void {
    it('accepts valid numbers', function (string $tckn): void {
        expect(Tckn::isValid($tckn))->toBeTrue();
    })->with(['10000000146', '12345678950', '11111111110', '99999999990', '19191919190', '10090908018']);

    it('rejects a wrong tenth or eleventh digit', function (string $tckn): void {
        expect(Tckn::isValid($tckn))->toBeFalse();
    })->with(['10000000147', '10000000156', '12345678901', '11111111111', '10090908008']);

    it('rejects a leading zero and malformed input', function (string $tckn): void {
        expect(Tckn::isValid($tckn))->toBeFalse();
    })->with(['00000000000', '01000000146', '', '1000000014', '100000001466', '1000000014a', ' 10000000146']);

    it('uses a non-negative modulo when the even sum outweighs seven times the odd sum', function (): void {
        // odd sum 1, even sum 26: 7 - 26 = -19; PHP's % would give -9, the check digit is 1.
        expect(Tckn::checkDigits('100909080'))->toBe('18')
            ->and(fn () => Tckn::checkDigits('012345678'))->toThrow(InvalidArgumentException::class);
    });
});

describe('IBAN', function (): void {
    it('accepts registry examples', function (string $iban): void {
        expect(Iban::isValid($iban))->toBeTrue();
    })->with([
        'TR330006100519786457841326', 'TR320010009999901234567890', 'GB82WEST12345698765432',
        'DE89370400440532013000', 'FR1420041010050500013M02606', 'NL91ABNA0417164300', 'BE68539007547034',
        'CH9300762011623852957', 'NO9386011117947', 'MT84MALT011000012345MTLCAST001S',
        'TR3400061005197864578413AB', // alphanumeric account part
    ]);

    it('normalizes spaces and case before checking', function (): void {
        expect(Iban::isValid('tr33 0006 1005 1978 6457 8413 26'))->toBeTrue()
            ->and(Iban::normalize(" tr33 0006\t1005 "))->toBe('TR3300061005')
            ->and(Iban::country('gb82 west'))->toBe('GB');
    });

    it('rejects a wrong checksum', function (string $iban): void {
        expect(Iban::isValid($iban))->toBeFalse();
    })->with([
        'TR330006100519786457841327', 'GB82WEST12345698765433', 'DE89370400440532013001',
        // transposed digits
        'TR330006100519786457843126',
    ]);

    it('rejects check digits 00, 01 and 99 even when congruent mod 97', function (): void {
        // Real check digits 98 and 02; 01 = 98 - 97 and 99 = 02 + 97 pass the bare checksum.
        expect(Iban::isValid('GB98WEST12345698760003'))->toBeTrue()
            ->and(Iban::isValid('GB01WEST12345698760003'))->toBeFalse()
            ->and(Iban::isValid('GB02WEST12345698760082'))->toBeTrue()
            ->and(Iban::isValid('GB99WEST12345698760082'))->toBeFalse()
            ->and(Iban::isValid('GB00WEST12345698760082'))->toBeFalse();
    });

    it('enforces country lengths and the TR layout', function (string $iban): void {
        expect(Iban::isValid($iban))->toBeFalse();
    })->with([
        // Each of these has a correct mod 97 checksum; only the layout is wrong.
        'TR23000610051978645784132', // 25 chars
        'TR080006110519786457841326', // reserve digit 1
        'TR37A006100519786457841326', // letter in bank code
        'DE5137040044053201300', // DE is 22 long
        'TR3300061005197864578413261', // 27 chars
        'DE0537040044053201300A', // DE BBAN is 18 digits, a letter is not allowed
        'GB731EST12345698765432', // GB bank code is 4 letters
        'NL591234ABCD567890', // NL is 4 letters then 10 digits
        '', 'TR', '1234567890123456', 'TRXX0006100519786457841326', 'TR33-0006-1005',
    ]);

    it('rejects countries missing from the registry even with a correct checksum', function (): void {
        expect(Iban::isValid('ZZ92ABCD1234567890'))->toBeFalse()
            ->and(Iban::isValid('XX'.substr('TR330006100519786457841326', 2)))->toBeFalse()
            ->and(Iban::length('tr'))->toBe(26)
            ->and(Iban::length('DE'))->toBe(22)
            ->and(Iban::length('MT'))->toBe(31)
            ->and(Iban::length('ZZ'))->toBeNull();
    });

    it('masks all but the country code and the last four characters', function (): void {
        expect(Iban::mask('TR33 0006 1005 1978 6457 8413 26'))->toBe('TR'.str_repeat('*', 20).'1326')
            ->and(Iban::mask('DE89370400440532013000'))->toBe('DE****************3000')
            ->and(Iban::mask('ABC'))->toBe('***');
    });
});

describe('trailing line breaks', function (): void {
    it('rejects otherwise valid numbers followed by a newline', function (): void {
        expect(Vkn::isValid("1234567890\n"))->toBeFalse()
            ->and(Vkn::isValid('1234567890'))->toBeTrue()
            ->and(Tckn::isValid("10000000146\n"))->toBeFalse()
            ->and(Tckn::isValid('10000000146'))->toBeTrue()
            ->and(TaxNumber::error(PartyType::Company, 'DE', "DE123\n"))->toBe('parties::messages.invalid_foreign_tax_number')
            ->and(fn () => Vkn::checkDigit("123456789\n"))->toThrow(InvalidArgumentException::class)
            ->and(fn () => Tckn::checkDigits("123456789\n"))->toThrow(InvalidArgumentException::class);
    });
});

describe('tax number by party type and country', function (): void {
    it('requires a VKN for Turkish companies and a TCKN for Turkish persons', function (): void {
        expect(TaxNumber::error(PartyType::Company, 'TR', '1234567890'))->toBeNull()
            ->and(TaxNumber::error(PartyType::Company, 'TR', '10000000146'))->toBe('parties::messages.invalid_vkn')
            ->and(TaxNumber::error(PartyType::Person, 'TR', '10000000146'))->toBeNull()
            ->and(TaxNumber::error(PartyType::Person, 'TR', '1234567890'))->toBe('parties::messages.invalid_tckn')
            ->and(TaxNumber::error(PartyType::Company, 'tr', '1234567891'))->toBe('parties::messages.invalid_vkn');
    });

    it('accepts any reasonable identifier abroad', function (): void {
        expect(TaxNumber::error(PartyType::Company, 'DE', 'DE123456789'))->toBeNull()
            ->and(TaxNumber::error(PartyType::Person, 'GB', 'GB 123/456.78-9'))->toBeNull()
            ->and(TaxNumber::error(PartyType::Company, 'DE', str_repeat('1', 33)))->toBe('parties::messages.invalid_foreign_tax_number')
            ->and(TaxNumber::error(PartyType::Company, 'DE', '=HYPERLINK()'))->toBe('parties::messages.invalid_foreign_tax_number');
    });

    it('strips separators only for Turkish numbers', function (): void {
        expect(TaxNumber::normalize(' 123 456-78.90 ', 'TR'))->toBe('1234567890')
            ->and(TaxNumber::normalize(' DE 123 ', 'DE'))->toBe('DE 123');
    });

    it('compares tax numbers in one canonical form', function (): void {
        expect(TaxNumber::canonical('DE123456789'))->toBe('DE123456789')
            ->and(TaxNumber::canonical('de123456789'))->toBe('DE123456789')
            ->and(TaxNumber::canonical('DE 123.456-789'))->toBe('DE123456789')
            ->and(TaxNumber::canonical('gb/12 34'))->toBe('GB1234')
            ->and(TaxNumber::canonical(' - '))->toBeNull()
            ->and(TaxNumber::canonical(null))->toBeNull();
    });
});
