<?php

declare(strict_types=1);

namespace App\Modules\Reference\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class InvalidRateFeed extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::ValidationError, __('reference::messages.invalid_feed'));
    }
}
