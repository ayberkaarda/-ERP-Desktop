<?php

declare(strict_types=1);

namespace App\Modules\Reference\Data;

final readonly class RecordData
{
    /** @param array<string, mixed> $attributes */
    public function __construct(public array $attributes, public ?int $version = null) {}
}
