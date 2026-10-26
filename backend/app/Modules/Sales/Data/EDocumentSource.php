<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

final readonly class EDocumentSource
{
    /** @param array<string,mixed> $payload */
    public function __construct(public string $id, public int $version, public bool $eligible, public string $fingerprint, public array $payload) {}
}
