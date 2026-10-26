<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Services;

use App\Modules\Treasury\Banking\Data\StatementData;
use App\Modules\Treasury\Banking\Data\StatementLineData;
use App\Modules\Treasury\Banking\Support\Extension;
use Brick\Math\BigDecimal;

final class StatementParser
{
    /** @param array<string, mixed> $options */
    public function parse(string $format, string $content, array $options = []): StatementData
    {
        if ($content === '' || strlen($content) > 2 * 1024 * 1024 || ! mb_check_encoding($content, 'UTF-8') || str_contains($content, "\0")) {
            Extension::fail('content', 'invalid_content');
        }
        $statement = match ($format) {
            'csv' => $this->csv($content, $options),
            'mt940' => $this->mt940($content),
            default => Extension::fail('format', 'invalid_format'),
        };
        $total = BigDecimal::of($statement->opening);
        foreach ($statement->lines as $line) {
            $total = $total->plus($line->amount);
            if ($line->date < $statement->from || $line->date > $statement->to) {
                Extension::fail('content', 'invalid_date');
            }
        }
        if (! $total->isEqualTo($statement->closing) || count($statement->lines) > 5000) {
            Extension::fail('closing_balance', 'balance_mismatch');
        }

        return $statement;
    }

    /** @param array<string, mixed> $options */
    private function csv(string $content, array $options): StatementData
    {
        $delimiter = match ($options['delimiter'] ?? 'comma') {
            'comma' => ',', 'semicolon' => ';', 'tab' => "\t",
            default => Extension::fail('delimiter', 'invalid_format'),
        };
        $decimal = $options['decimal_separator'] ?? '.';
        if (! in_array($decimal, ['.', ','], true)) {
            Extension::fail('decimal_separator', 'invalid_format');
        }
        $mapping = is_array($options['mapping'] ?? null) ? $options['mapping'] : [];
        $stream = fopen('php://temp', 'w+');
        if ($stream === false) {
            Extension::fail('content', 'invalid_content');
        }
        try {
            fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $content) ?? $content);
            rewind($stream);
            $headers = fgetcsv($stream, separator: $delimiter, escape: '');
            if ($headers === false || count($headers) !== count(array_unique($headers))) {
                Extension::fail('content', 'invalid_content');
            }
            $positions = [];
            foreach (['date', 'amount', 'reference', 'description', 'value_date'] as $field) {
                $name = $mapping[$field] ?? $field;
                $positions[$field] = is_string($name) ? array_search($name, $headers, true) : false;
            }
            if ($positions['date'] === false || $positions['amount'] === false) {
                Extension::fail('mapping', 'invalid_content');
            }
            $lines = [];
            while (($row = fgetcsv($stream, separator: $delimiter, escape: '')) !== false) {
                if ($row === [null]) {
                    continue;
                }
                if (count($row) !== count($headers) || count($lines) >= 5000) {
                    Extension::fail('content', 'invalid_content');
                }
                $get = static fn (string $field): string => $positions[$field] === false ? '' : trim((string) ($row[$positions[$field]] ?? ''));
                $date = Extension::date($get('date'));
                $amount = $this->number($get('amount'), $decimal);
                if (BigDecimal::of($amount)->isZero()) {
                    Extension::fail('amount', 'invalid_amount');
                }
                $lines[] = new StatementLineData($date, Extension::date($get('value_date') ?: $date), $amount,
                    mb_substr($get('reference'), 0, 255), mb_substr($get('description'), 0, 1000));
            }
        } finally {
            fclose($stream);
        }
        if ($lines === []) {
            Extension::fail('content', 'invalid_content');
        }
        $dates = array_map(static fn (StatementLineData $line): string => $line->date, $lines);
        $currency = $options['currency_code'] ?? '';
        if (! is_string($currency) || preg_match('/^[A-Z]{3}$/D', $currency) !== 1) {
            Extension::fail('currency_code', 'invalid_currency');
        }

        return new StatementData((string) ($options['bank_reference'] ?? ''), '', $currency, min($dates), max($dates),
            $this->number((string) ($options['opening_balance'] ?? ''), '.'),
            $this->number((string) ($options['closing_balance'] ?? ''), '.'), $lines);
    }

    private function number(string $value, string $separator): string
    {
        $pattern = $separator === ',' ? '/^-?\d{1,16}(?:,\d{1,4})?$/D' : '/^-?\d{1,16}(?:\.\d{1,4})?$/D';
        if (preg_match($pattern, $value) !== 1) {
            Extension::fail('amount', 'invalid_amount');
        }

        return Extension::money(str_replace(',', '.', $value));
    }

    /** A complete, single-account final statement; intermediate/multi-message SWIFT blocks are rejected. */
    private function mt940(string $content): StatementData
    {
        $tags = [];
        foreach (preg_split('/\r\n|\n|\r/', trim($content)) ?: [] as $line) {
            if (preg_match('/^:([0-9]{2}[A-Z]?):(.*)$/D', $line, $match) === 1) {
                $tags[] = ['tag' => $match[1], 'text' => $match[2]];
            } elseif ($tags !== [] && end($tags)['tag'] === '86' && ! str_starts_with($line, ':')) {
                $last = array_key_last($tags);
                $tags[$last]['text'] .= ' '.$line;
            } else {
                Extension::fail('content', 'invalid_mt940');
            }
        }
        if (array_slice(array_column($tags, 'tag'), 0, 4) !== ['20', '25', '28C', '60F']) {
            Extension::fail('content', 'invalid_mt940');
        }
        $single = [];
        $lines = [];
        $closed = false;
        foreach ($tags as $tag) {
            $name = $tag['tag'];
            $value = $tag['text'];
            if (in_array($name, ['20', '25', '28C', '60F', '62F'], true)) {
                if (isset($single[$name]) || ($closed && $name !== '62F')) {
                    Extension::fail('content', 'invalid_mt940');
                }
                $single[$name] = $value;
                if ($name === '62F') {
                    $closed = true;
                }
            } elseif ($name === '61') {
                if (! isset($single['60F']) || $closed || count($lines) >= 5000 || preg_match('/^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d{1,15},\d{0,4})([SNF][A-Z0-9]{3})(.{1,66})$/D', $value, $m) !== 1) {
                    Extension::fail('content', 'invalid_mt940');
                }
                if (strlen($m[5]) > 15 || $m[4] !== '' && $m[4] !== substr($single['60F'], 9, 1)) {
                    Extension::fail('content', 'invalid_mt940');
                }
                $date = $this->swiftDate($m[1]);
                $booking = $date;
                if ($m[2] !== '') {
                    $year = (int) substr($date, 0, 4);
                    $month = (int) substr($m[2], 0, 2);
                    $valueMonth = (int) substr($date, 5, 2);
                    $year += $valueMonth === 12 && $month === 1 ? 1 : ($valueMonth === 1 && $month === 12 ? -1 : 0);
                    $booking = Extension::date(sprintf('%04d-%s-%s', $year, substr($m[2], 0, 2), substr($m[2], 2, 2)));
                }
                $amount = $this->number(rtrim($m[5], ','), ',');
                if (in_array($m[3], ['D', 'RC'], true)) {
                    $amount = Extension::money(BigDecimal::of($amount)->negated()->__toString());
                }
                if (BigDecimal::of($amount)->isZero()) {
                    Extension::fail('amount', 'invalid_amount');
                }
                $lines[] = new StatementLineData($booking, $date, $amount, $m[7], '');
            } elseif ($name === '86' && $lines !== [] && ! $closed) {
                $index = array_key_last($lines);
                $old = $lines[$index];
                $lines[$index] = new StatementLineData($old->date, $old->valueDate, $old->amount, $old->reference, mb_substr($value, 0, 1000));
            } elseif (in_array($name, ['64', '65'], true) && $closed) {
                $available = $this->swiftBalance($value);
                if (! isset($single['60F']) || $available[1] !== substr($single['60F'], 7, 3)) {
                    Extension::fail('content', 'invalid_mt940');
                }
            } else {
                Extension::fail('content', 'invalid_mt940');
            }
        }
        foreach (['20', '25', '28C', '60F', '62F'] as $required) {
            if (! isset($single[$required]) || $single[$required] === '') {
                Extension::fail('content', 'invalid_mt940');
            }
        }
        if (strlen($single['20']) > 16 || strlen($single['25']) > 35 || preg_match('/^\d{1,5}(?:\/\d{1,5})?$/D', $single['28C']) !== 1) {
            Extension::fail('content', 'invalid_mt940');
        }
        $opening = $this->swiftBalance($single['60F']);
        $closing = $this->swiftBalance($single['62F']);
        if ($opening[1] !== $closing[1] || $opening[0] > $closing[0]) {
            Extension::fail('content', 'invalid_mt940');
        }

        return new StatementData($single['20'].'/'.$single['28C'], $single['25'], $opening[1], $opening[0], $closing[0], $opening[2], $closing[2], $lines);
    }

    /** @return array{string,string,string} */
    private function swiftBalance(string $value): array
    {
        if (preg_match('/^([CD])(\d{6})([A-Z]{3})(\d{1,15},\d{0,4})$/D', $value, $m) !== 1 || strlen($m[4]) > 15) {
            Extension::fail('content', 'invalid_mt940');
        }
        $amount = $this->number(rtrim($m[4], ','), ',');

        return [$this->swiftDate($m[2]), $m[3], $m[1] === 'D' ? Extension::money(BigDecimal::of($amount)->negated()->__toString()) : $amount];
    }

    private function swiftDate(string $value): string
    {
        $year = (int) substr($value, 0, 2);

        return Extension::date(sprintf('%04d-%s-%s', $year >= 70 ? 1900 + $year : 2000 + $year, substr($value, 2, 2), substr($value, 4, 2)));
    }
}
