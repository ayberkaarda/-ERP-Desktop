<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

interface EDocumentSourceGuard
{
    public function assertReversible(string $type, string $id): void;
}
