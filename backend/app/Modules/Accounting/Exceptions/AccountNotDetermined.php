<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Accounting\Support\Messages;

final class AccountNotDetermined extends ApiException
{
    public function __construct(public readonly string $eventKey)
    {
        $message = Messages::get('account_not_determined', ['event' => $eventKey]);

        parent::__construct(ErrorCode::ValidationError, $message, ['event_key' => [$message]]);
    }
}
