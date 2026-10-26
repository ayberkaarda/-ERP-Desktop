<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Modules\Parties\Contracts\IbanValidation;
use App\Modules\Parties\Validation\Iban;

final class IbanValidationAdapter implements IbanValidation
{
    public function isValid(string $value): bool
    {
        return Iban::isValid($value);
    }
}
