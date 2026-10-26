<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Data;

use InvalidArgumentException;

/** Immutable domain snapshot; monetary strings are never repriced by XML generation. */
final readonly class XmlDocumentSnapshot
{
    /** @param array<string, mixed> $values */
    private function __construct(private array $values) {}

    /** @param array<string, mixed> $values */
    public static function fromArray(array $values): self
    {
        if (! in_array($values['kind'] ?? null, ['e_invoice', 'e_archive', 'e_despatch'], true)) {
            throw new InvalidArgumentException('Unsupported electronic document kind.');
        }

        return new self($values);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return $this->values;
    }
}
