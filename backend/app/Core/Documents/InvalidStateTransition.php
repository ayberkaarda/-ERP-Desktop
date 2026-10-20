<?php

declare(strict_types=1);

namespace App\Core\Documents;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class InvalidStateTransition extends ApiException
{
    public function __construct(public readonly string $from, public readonly string $to)
    {
        parent::__construct(ErrorCode::InvalidStateTransition);
    }
}
