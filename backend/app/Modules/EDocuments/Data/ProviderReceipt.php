<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Data;

final readonly class ProviderReceipt
{
    public function __construct(public string $id, public string $status) {}
}
