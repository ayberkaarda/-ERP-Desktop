<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Data;

final readonly class UnitData
{
    public function __construct(
        public string $id,
        public string $code,
        public string $name,
        public ?string $symbol,
        public bool $isActive,
    ) {}
}
