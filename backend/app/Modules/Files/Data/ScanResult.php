<?php

declare(strict_types=1);

namespace App\Modules\Files\Data;

final readonly class ScanResult
{
    public function __construct(public bool $clean, public ?string $threat = null) {}

    public static function clean(): self
    {
        return new self(true);
    }

    public static function infected(string $threat): self
    {
        return new self(false, $threat);
    }
}
