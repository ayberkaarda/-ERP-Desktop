<?php

declare(strict_types=1);

/**
 * Data integrity of the Tek Düzen Hesap Planı seed file. Parses the JSON
 * directly so it does not depend on any Accounting module code.
 */
const TDHP_DATA_FILE = __DIR__.'/../../../app/Modules/Accounting/Database/data/tdhp.json';

const TDHP_SOURCE_REFS = ['MSUGT-1', 'MSUGT-2', 'MSUGT-4', 'MSUGT-11', 'MSUGT-12'];

/**
 * @return list<array<string, mixed>>
 */
function tdhpRows(): array
{
    $raw = file_get_contents(TDHP_DATA_FILE);
    expect($raw)->toBeString();

    $rows = json_decode((string) $raw, true, 512, JSON_THROW_ON_ERROR);
    expect($rows)->toBeArray()->and(array_is_list($rows))->toBeTrue();

    /** @var list<array<string, mixed>> $rows */
    return $rows;
}

/**
 * @return array<string, array<string, mixed>>
 */
function tdhpByCode(): array
{
    $byCode = [];
    foreach (tdhpRows() as $row) {
        $byCode[(string) $row['code']] = $row;
    }

    return $byCode;
}

it('is a valid, non-empty JSON array with the expected keys', function (): void {
    $rows = tdhpRows();
    expect(count($rows))->toBeGreaterThan(300);

    $keys = ['code', 'name', 'parent_code', 'type', 'normal_balance', 'tdhp_group', 'postable', 'scheme', 'flags', 'status', 'source_ref'];
    foreach ($rows as $row) {
        expect(array_keys($row))->toEqualCanonicalizing($keys)
            ->and($row['flags'])->toBeArray()
            ->and(array_keys($row['flags']))->toEqualCanonicalizing(['requires_party', 'requires_cost_center', 'is_revaluable']);
        foreach ($row['flags'] as $flag) {
            expect($flag)->toBeBool();
        }
        expect($row['name'])->toBeString()->not->toBe('')
            ->and(trim($row['name']))->toBe($row['name'])
            ->and($row['postable'])->toBeBool();
    }
});

it('has unique codes in the official format', function (): void {
    $codes = array_map(static fn (array $r): mixed => $r['code'], tdhpRows());

    expect($codes)->toEqual(array_values(array_unique($codes)));
    foreach ($codes as $code) {
        expect($code)->toBeString()->toMatch('/^[1-9]([0-9]([0-9](\.[0-9]{2,})*)?)?$/');
    }
});

it('links every entry to an existing, prefix-compatible parent', function (): void {
    $byCode = tdhpByCode();

    foreach ($byCode as $code => $row) {
        $code = (string) $code;
        if (strlen($code) === 1) {
            expect($row['parent_code'])->toBeNull();

            continue;
        }

        $parent = $row['parent_code'];
        expect($parent)->toBeString()
            ->and($byCode)->toHaveKey($parent)
            ->and(str_starts_with($code, $parent))->toBeTrue();

        $expected = match (true) {
            strlen($code) === 2 => substr($code, 0, 1),
            strlen($code) === 3 => substr($code, 0, 2),
            default => substr($code, 0, (int) strrpos($code, '.')),
        };
        expect($parent)->toBe($expected, "parent of {$code}");
        expect($byCode[$parent]['postable'])->toBeFalse("parent {$parent} must not be postable");
    }
});

it('uses only valid enum values', function (): void {
    foreach (tdhpRows() as $row) {
        expect($row['type'])->toBeIn(['asset', 'liability', 'equity', 'revenue', 'expense', 'cost', 'memo'])
            ->and($row['normal_balance'])->toBeIn(['debit', 'credit'])
            ->and($row['status'])->toBeIn(['verified', 'needs_review'])
            ->and($row['scheme'])->toBeIn([null, '7A', '7B'])
            ->and($row['tdhp_group'])->toBeInt()->toBeGreaterThanOrEqual(1)->toBeLessThanOrEqual(9);
    }
});

it('keeps the tdhp group consistent with the first digit and the class type', function (): void {
    $classType = [1 => 'asset', 2 => 'asset', 3 => 'liability', 4 => 'liability', 5 => 'equity', 7 => 'cost', 9 => 'memo'];

    foreach (tdhpRows() as $row) {
        $group = (int) substr($row['code'], 0, 1);
        expect($row['tdhp_group'])->toBe($group, $row['code']);
        if (isset($classType[$group])) {
            expect($row['type'])->toBe($classType[$group], $row['code']);
        } else {
            expect($row['type'])->toBeIn(['revenue', 'expense'], $row['code']);
        }
    }
});

it('marks only main accounts (3+ digits) as postable', function (): void {
    foreach (tdhpRows() as $row) {
        expect($row['postable'])->toBe(strlen($row['code']) >= 3, $row['code']);
    }
});

it('assigns the 7A or 7B scheme only to cost accounts', function (): void {
    foreach (tdhpRows() as $row) {
        $code = $row['code'];
        if ($code[0] !== '7' || strlen($code) === 1) {
            expect($row['scheme'])->toBeNull($code);

            continue;
        }
        expect($row['scheme'])->toBe(str_starts_with($code, '79') ? '7B' : '7A', $code);
    }
});

it('requires a cost center only on 7xx expense accounts', function (): void {
    foreach (tdhpRows() as $row) {
        if ($row['flags']['requires_cost_center']) {
            expect($row['code'][0])->toBe('7')
                ->and($row['postable'])->toBeTrue()
                ->and($row['normal_balance'])->toBe('debit');
        }
    }
});

it('gives contra accounts of balance sheet classes the opposite normal balance', function (): void {
    $nature = [1 => 'debit', 2 => 'debit', 3 => 'credit', 4 => 'credit', 5 => 'credit'];

    foreach (tdhpRows() as $row) {
        $group = $row['tdhp_group'];
        if (! isset($nature[$group])) {
            continue;
        }
        $isContra = str_ends_with($row['name'], '(-)');
        if ($isContra) {
            expect($row['normal_balance'])->not->toBe($nature[$group], $row['code']);
        }
    }
});

it('matches anchor accounts of the Tebliğ', function (string $code, string $name, string $type, string $balance): void {
    $byCode = tdhpByCode();

    expect($byCode)->toHaveKey($code)
        ->and($byCode[$code]['name'])->toBe($name)
        ->and($byCode[$code]['type'])->toBe($type)
        ->and($byCode[$code]['normal_balance'])->toBe($balance);
})->with([
    ['100', 'Kasa', 'asset', 'debit'],
    ['102', 'Bankalar', 'asset', 'debit'],
    ['103', 'Verilen Çekler ve Ödeme Emirleri (-)', 'asset', 'credit'],
    ['120', 'Alıcılar', 'asset', 'debit'],
    ['153', 'Ticari Mallar', 'asset', 'debit'],
    ['191', 'İndirilecek Katma Değer Vergisi', 'asset', 'debit'],
    ['257', 'Birikmiş Amortismanlar (-)', 'asset', 'credit'],
    ['268', 'Birikmiş Amortismanlar (-)', 'asset', 'credit'],
    ['299', 'Birikmiş Amortismanlar (-)', 'asset', 'credit'],
    ['320', 'Satıcılar', 'liability', 'credit'],
    ['371', 'Dönem Kârının Peşin Ödenen Vergi ve Diğer Yükümlülükleri (-)', 'liability', 'debit'],
    ['391', 'Hesaplanan KDV', 'liability', 'credit'],
    ['500', 'Sermaye', 'equity', 'credit'],
    ['580', 'Geçmiş Yıllar Zararları', 'equity', 'debit'],
    ['600', 'Yurtiçi Satışlar', 'revenue', 'credit'],
    ['610', 'Satıştan İadeler (-)', 'revenue', 'debit'],
    ['621', 'Satılan Ticari Mallar Maliyeti (-)', 'expense', 'debit'],
    ['646', 'Kambiyo Kârları', 'revenue', 'credit'],
    ['656', 'Kambiyo Zararları (-)', 'expense', 'debit'],
    ['770', 'Genel Yönetim Giderleri', 'cost', 'debit'],
    ['771', 'Genel Yönetim Giderleri Yansıtma Hesabı', 'cost', 'credit'],
    ['794', 'Çeşitli Giderler', 'cost', 'debit'],
]);

it('covers both cost schemes', function (): void {
    $byCode = tdhpByCode();

    foreach (['710', '720', '730', '740', '750', '760', '770', '780'] as $code) {
        expect($byCode[$code]['scheme'])->toBe('7A');
    }
    foreach (range(790, 799) as $code) {
        expect($byCode[(string) $code]['scheme'])->toBe('7B');
    }
});

it('references a documented source for every entry', function (): void {
    foreach (tdhpRows() as $row) {
        expect($row['source_ref'])->toBeString()->toBeIn(TDHP_SOURCE_REFS);
        if ($row['status'] === 'needs_review') {
            expect($row['source_ref'])->not->toBe('');
        }
    }
});
