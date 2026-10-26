<?php

declare(strict_types=1);

namespace App\Modules\Parties\Contracts;

interface IbanValidation
{
    public function isValid(string $value): bool;
}
