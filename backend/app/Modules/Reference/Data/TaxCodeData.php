<?php

declare(strict_types=1);

namespace App\Modules\Reference\Data;

use App\Modules\Reference\Enums\TaxType;

final readonly class TaxCodeData
{
    /** @param array<string, mixed> $meta */
    public function __construct(
        public string $id,
        public string $code,
        public TaxType $type,
        public ?string $rate,
        public ?int $numerator,
        public ?int $denominator,
        public string $effectiveFrom,
        public ?string $effectiveTo,
        public array $meta,
    ) {}
}
