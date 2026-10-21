<?php

declare(strict_types=1);

namespace App\Modules\Reference\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class InvalidRateFeed extends ApiException
{
    public function __construct(public readonly ?string $currency = null)
    {
        parent::__construct(ErrorCode::ValidationError, $currency === null
            ? __('reference::messages.invalid_feed')
            : __('reference::messages.incomplete_feed_row', ['currency' => $currency]));
    }
}
