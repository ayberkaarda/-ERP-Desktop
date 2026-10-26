<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use JsonException;
use stdClass;

final class PrivacyFilter
{
    public function text(string $value): string
    {
        if (! config('assistant.mask_pii', true)) {
            return $value;
        }
        $value = (string) preg_replace([
            '/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu',
            '/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/u',
        ], ['[email]', '[iban]'], $value);

        // A dot-separated telephone can resemble a decimal. Explicit contact labels resolve that
        // ambiguity before protecting financial decimals and record identifiers in free text.
        $value = (string) preg_replace('/(\b(?:phone|mobile|telephone|tel|fax|gsm|telefon|cep|téléphone|rufnummer)\b\s*:?\s*)(\+?\d(?:[ ().-]*\d){9,14})(?!\d)/iu', '$1[number]', $value);

        return (string) preg_replace(
            '/(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?\b|(?<![\pL\d.])[+-]?\d+\.\d+(?![\d.]))(*SKIP)(*F)|(?<![\pL\d-])\+?\d(?:[ ().-]*\d){9,14}(?![\pL\d-])/iu',
            '[number]',
            $value,
        );
    }

    public function data(mixed $value): mixed
    {
        if (! config('assistant.mask_pii', true)) {
            return $value;
        }
        if (is_string($value)) {
            if (preg_match('/^[+-]?\d+\.\d+$/', $value) === 1) {
                return $value;
            }
            $start = ltrim($value);
            if (str_starts_with($start, '{') || str_starts_with($start, '[')) {
                try {
                    $decoded = json_decode($value, flags: JSON_THROW_ON_ERROR);
                    if (is_array($decoded) || $decoded instanceof stdClass) {
                        return json_encode($this->data($decoded), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    }
                } catch (JsonException) {
                    // Ordinary record text can start with a brace; apply the text filter below.
                }
            }

            return $this->text($value);
        }
        if ($value instanceof stdClass) {
            return (object) $this->data(get_object_vars($value));
        }
        if (is_array($value)) {
            $safe = [];
            foreach ($value as $key => $item) {
                if (is_string($key) && is_string($item) && preg_match('/(?:^|_)(?:phone|mobile|telephone|fax|gsm|telefon|tel)(?:_number)?$/iu', $key) === 1 && preg_match('/\d(?:[ ().+-]*\d){9,14}/', $item) === 1) {
                    $safe[$key] = '[number]';

                    continue;
                }
                // UUIDs, quantities, money and ISO dates are business values, not contact fields.
                if (is_string($item) && (preg_match('/^[0-9a-f]{8}-[0-9a-f-]{27}$/i', $item) === 1 || preg_match('/^\d{4}-\d{2}-\d{2}$/', $item) === 1 || preg_match('/^-?\d+(\.\d+)?$/', $item) === 1 && is_string($key) && preg_match('/amount|total|balance|quantity|price|rate|tokens|debit|credit|available|estimated|overdue|days_|^current$/', $key) === 1)) {
                    $safe[$key] = $item;
                } else {
                    $safe[$key] = $this->data($item);
                }
            }

            return $safe;
        }

        return $value;
    }
}
