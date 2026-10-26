<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Data;

final readonly class TreasuryAccountData
{
    public function __construct(public string $id, public string $companyId, public string $type, public string $code, public string $name, public string $currencyCode, public string $glAccountId, public bool $isActive, public bool $allowNegative, public int $version, public ?string $iban = null) {}
}
