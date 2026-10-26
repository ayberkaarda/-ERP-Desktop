<?php

declare(strict_types=1);

namespace App\Modules\Identity\Support;

/**
 * Neutralises spreadsheet formula injection in exported cells (CSV and XLSX).
 */
final class CsvFormulaGuard
{
    private const array TRIGGERS = ['=', '+', '-', '@', "\t", "\r", "\n"];

    public static function cell(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (is_array($value) || is_object($value)) {
            $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        }

        $string = is_scalar($value) ? (string) $value : '';

        if ($string !== '' && in_array($string[0], self::TRIGGERS, true)) {
            return "'".$string;
        }

        return $string;
    }

    /**
     * @param  array<int|string, mixed>  $row
     * @return list<string>
     */
    public static function row(array $row): array
    {
        return array_values(array_map(self::cell(...), $row));
    }
}
