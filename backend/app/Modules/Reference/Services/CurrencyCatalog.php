<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Models\Currency;
use Illuminate\Support\Str;

/**
 * ISO 4217 rows the module ships with (code, name, symbol, minor unit digits). Used by the
 * ReferenceSeeder (all rows) and by the company bootstrap (only the currencies it activates).
 */
final class CurrencyCatalog
{
    /** @var list<array{0: string, 1: string, 2: string, 3: int}> */
    public const array CURRENCIES = [
        ['TRY', 'Türk lirası', '₺', 2], ['USD', 'US dollar', '$', 2],
        ['EUR', 'Euro', '€', 2], ['GBP', 'Pound sterling', '£', 2],
        ['CHF', 'Swiss franc', 'CHF', 2], ['JPY', 'Japanese yen', '¥', 0],
        ['AUD', 'Australian dollar', 'A$', 2], ['CAD', 'Canadian dollar', 'C$', 2],
        ['DKK', 'Danish krone', 'kr', 2], ['NOK', 'Norwegian krone', 'kr', 2],
        ['SEK', 'Swedish krona', 'kr', 2], ['SAR', 'Saudi riyal', 'SAR', 2],
        ['KWD', 'Kuwaiti dinar', 'KWD', 3], ['CNY', 'Chinese yuan', '¥', 2],
        ['RUB', 'Russian ruble', '₽', 2], ['AED', 'UAE dirham', 'AED', 2],
        ['AZN', 'Azerbaijani manat', '₼', 2], ['BGN', 'Bulgarian lev', 'лв', 2],
        ['RON', 'Romanian leu', 'lei', 2], ['PKR', 'Pakistani rupee', 'Rs', 2],
        ['QAR', 'Qatari riyal', 'QAR', 2], ['KRW', 'South Korean won', '₩', 0],
    ];

    /**
     * Creates the missing global rows; existing rows (also soft deleted or deactivated ones) are
     * kept as they are. One INSERT ... ON CONFLICT (code) DO NOTHING, so two first companies
     * created at the same time cannot fail on each other's row (no activity log entries for these
     * shipped reference rows).
     *
     * @param  list<string>|null  $codes  null: every shipped currency
     */
    public static function ensure(?array $codes = null): void
    {
        $now = now();
        $rows = [];
        foreach (self::CURRENCIES as [$code, $name, $symbol, $decimals]) {
            if ($codes === null || in_array($code, $codes, true)) {
                $rows[] = [
                    'id' => (string) Str::uuid7(), 'code' => $code, 'name' => $name, 'symbol' => $symbol, 'decimals' => $decimals,
                    'is_active' => true, 'version' => 1, 'created_at' => $now, 'updated_at' => $now,
                ];
            }
        }
        if ($rows !== []) {
            Currency::query()->insertOrIgnore($rows);
        }
    }
}
