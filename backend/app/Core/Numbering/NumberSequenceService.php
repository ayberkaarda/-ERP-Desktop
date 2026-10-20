<?php

declare(strict_types=1);

namespace App\Core\Numbering;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;

/**
 * Gapless document numbers per (company, doc type, series, fiscal year).
 *
 * The counter row stays locked until the caller's transaction ends, so a rolled
 * back document returns its number. Call next() inside the transaction that
 * persists the numbered document.
 */
final class NumberSequenceService
{
    public const string DEFAULT_FORMAT = '{series}{year}{seq:9}';

    /**
     * @param  array<string, string>  $formats  per doc type
     */
    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly string $defaultFormat = self::DEFAULT_FORMAT,
        private readonly array $formats = [],
    ) {}

    public function next(string $companyId, string $docType, ?string $series, int $fiscalYear): string
    {
        if ($docType === '' || $fiscalYear < 1900 || $fiscalYear > 9999) {
            throw new InvalidArgumentException('Invalid document type or fiscal year.');
        }

        $series ??= '';

        return $this->db->transaction(function () use ($companyId, $docType, $series, $fiscalYear): string {
            $this->db->table('number_sequences')->insertOrIgnore([
                'id' => (string) Str::uuid7(),
                'company_id' => $companyId,
                'doc_type' => $docType,
                'series' => $series,
                'fiscal_year' => $fiscalYear,
                'last_value' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $row = $this->db->table('number_sequences')
                ->where('company_id', $companyId)
                ->where('doc_type', $docType)
                ->where('series', $series)
                ->where('fiscal_year', $fiscalYear)
                ->lockForUpdate()
                ->first(['id', 'last_value', 'format']);

            if (! is_object($row) || ! property_exists($row, 'id') || ! property_exists($row, 'last_value')) {
                throw new RuntimeException('Number sequence row is missing.');
            }

            $value = (int) $row->last_value + 1;

            $this->db->table('number_sequences')
                ->where('id', $row->id)
                ->update(['last_value' => $value, 'updated_at' => now()]);

            $format = property_exists($row, 'format') && is_string($row->format) && $row->format !== ''
                ? $row->format
                : ($this->formats[$docType] ?? $this->defaultFormat);

            return self::format($format, $series, $fiscalYear, $value);
        });
    }

    /**
     * Tokens: {series}, {year}, {yy}, {seq} or {seq:N} (zero padded to N).
     */
    public static function format(string $format, string $series, int $fiscalYear, int $value): string
    {
        $result = preg_replace_callback(
            '/\{(series|year|yy|seq)(?::(\d{1,2}))?\}/',
            static fn (array $m): string => match ($m[1]) {
                'series' => $series,
                'year' => (string) $fiscalYear,
                'yy' => substr((string) $fiscalYear, -2),
                default => str_pad((string) $value, isset($m[2]) ? (int) $m[2] : 0, '0', STR_PAD_LEFT),
            },
            $format,
        );

        return $result ?? throw new RuntimeException('Invalid number format.');
    }
}
