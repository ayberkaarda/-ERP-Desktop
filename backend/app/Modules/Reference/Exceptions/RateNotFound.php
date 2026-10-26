<?php

declare(strict_types=1);

namespace App\Modules\Reference\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class RateNotFound extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::NotFound, __('reference::messages.rate_not_found'));
    }
}
