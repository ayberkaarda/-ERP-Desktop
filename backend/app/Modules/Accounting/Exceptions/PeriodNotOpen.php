<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Accounting\Support\Messages;

/**
 * No period for the date, or its period / fiscal year does not accept postings.
 */
final class PeriodNotOpen extends ApiException
{
    /**
     * @param  array<string, string|int|float>  $replace
     */
    public function __construct(string $key, array $replace = [], string $field = 'entry_date')
    {
        $message = Messages::get($key, $replace);

        parent::__construct(ErrorCode::ValidationError, $message, [$field => [$message]]);
    }
}
