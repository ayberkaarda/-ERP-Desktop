<?php

declare(strict_types=1);

use App\Modules\Parties\Validation\Iban;

/**
 * @return array<string, array{length: int, bban_pattern: string, example: string}>
 */
function ibanRegistryContract(): array
{
    $json = json_decode((string) file_get_contents(__DIR__.'/../../../../contracts/iban-registry.json'), true, 512, JSON_THROW_ON_ERROR);

    return $json['countries'];
}

describe('IBAN registry contract', function (): void {
    it('embeds exactly the countries, patterns and lengths of contracts/iban-registry.json', function (): void {
        $contract = ibanRegistryContract();
        $embedded = Iban::registry();

        expect(array_keys($embedded))->toEqualCanonicalizing(array_keys($contract));

        foreach ($contract as $country => $entry) {
            expect($embedded[$country])->toBe($entry['bban_pattern'], $country)
                ->and(Iban::length($country))->toBe($entry['length'], $country);
        }
    });

    it('validates every published registry example', function (string $country, string $example): void {
        expect(Iban::isValid($example))->toBeTrue()
            ->and(strlen($example))->toBe(Iban::length($country))
            ->and(Iban::country($example))->toBe($country);
    })->with(function (): Generator {
        foreach (ibanRegistryContract() as $country => $entry) {
            yield $country => [$country, $entry['example']];
        }
    });

    it('rejects every example once its check digits are mutated', function (string $example): void {
        $check = (int) substr($example, 2, 2);
        $mutated = substr($example, 0, 2).str_pad((string) (($check - 1) % 97 + 2), 2, '0', STR_PAD_LEFT).substr($example, 4);

        expect($mutated)->not->toBe($example)
            ->and(Iban::isValid($mutated))->toBeFalse();
    })->with(function (): Generator {
        foreach (ibanRegistryContract() as $country => $entry) {
            yield $country => [$entry['example']];
        }
    });

    it('rejects an example one character too long or too short', function (string $example): void {
        expect(Iban::isValid($example.'0'))->toBeFalse()
            ->and(Iban::isValid(substr($example, 0, -1)))->toBeFalse();
    })->with(function (): Generator {
        foreach (ibanRegistryContract() as $country => $entry) {
            yield $country => [$entry['example']];
        }
    });
});
