<?php

declare(strict_types=1);

namespace App\Modules\Sales\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Sales\Support\Messages;
use Illuminate\Database\QueryException;

/**
 * A sales invariant raised by a database trigger (SQLSTATE class KS), as a 422.
 */
final class SalesViolation extends ApiException
{
    /** SQLSTATE => message key. */
    public const array CODES = [
        'KS001' => 'violation_invoice_immutable',
        'KS002' => 'violation_invoice_lines_immutable',
        'KS003' => 'violation_delivery_immutable',
    ];

    public function __construct(public readonly string $sqlState, QueryException $previous)
    {
        $message = Messages::get(self::CODES[$sqlState] ?? 'violation_invoice_immutable');

        parent::__construct(ErrorCode::ValidationError, $message, ['document' => [$message]], previous: $previous);
    }

    public static function sqlState(QueryException $e): ?string
    {
        $state = $e->errorInfo[0] ?? $e->getCode();

        return is_string($state) && isset(self::CODES[$state]) ? $state : null;
    }
}
