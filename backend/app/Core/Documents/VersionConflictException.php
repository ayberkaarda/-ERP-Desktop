<?php

declare(strict_types=1);

namespace App\Core\Documents;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class VersionConflictException extends ApiException
{
    public function __construct(public readonly int $expected, public readonly int $current)
    {
        parent::__construct(ErrorCode::VersionConflict);
    }
}
