<?php

declare(strict_types=1);

namespace App\Modules\Organization\Contracts;

interface EDocumentCompany
{
    /** @return array<string,mixed> */
    public function profile(): array;
}
