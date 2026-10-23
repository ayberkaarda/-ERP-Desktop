<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Contracts\EDocumentSourceGuard;

final class EDocumentNullGuard implements EDocumentSourceGuard
{
    public function assertReversible(string $type, string $id): void {}
}
