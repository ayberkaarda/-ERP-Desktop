<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Services;

use RuntimeException;

final class InvalidXml extends RuntimeException
{
    /** @param array<string,mixed> $validation */
    public function __construct(public readonly array $validation)
    {
        parent::__construct('Electronic document validation failed.');
    }
}
