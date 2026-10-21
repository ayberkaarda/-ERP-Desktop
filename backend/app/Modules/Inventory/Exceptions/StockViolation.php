<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Inventory\Support\Messages;
use Illuminate\Database\QueryException;

/**
 * A stock invariant raised by a database trigger (SQLSTATE class KI), as a 422.
 */
final class StockViolation extends ApiException
{
    /** SQLSTATE => message key. */
    public const array CODES = [
        'KI001' => 'violation_movement_immutable',
        'KI002' => 'violation_negative_stock',
        'KI003' => 'violation_serial_transition',
        'KI004' => 'violation_movement_reference',
        'KI005' => 'violation_document_immutable',
    ];

    public function __construct(public readonly string $sqlState, QueryException $previous)
    {
        $message = Messages::get(self::CODES[$sqlState] ?? 'violation_negative_stock');

        parent::__construct(ErrorCode::ValidationError, $message, ['stock' => [$message]], previous: $previous);
    }

    public static function sqlState(QueryException $e): ?string
    {
        $state = $e->errorInfo[0] ?? $e->getCode();

        return is_string($state) && isset(self::CODES[$state]) ? $state : null;
    }
}
