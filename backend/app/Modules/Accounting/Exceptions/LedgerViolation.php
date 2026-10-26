<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Accounting\Support\Messages;
use Illuminate\Database\QueryException;

/**
 * A ledger invariant raised by a database trigger (SQLSTATE class KA), as a 422.
 */
final class LedgerViolation extends ApiException
{
    /** SQLSTATE => message key. */
    public const array CODES = [
        'KA001' => 'ledger_unbalanced',
        'KA002' => 'ledger_immutable',
        'KA003' => 'ledger_period_closed',
        'KA004' => 'ledger_account_in_use',
        'KA005' => 'ledger_date_outside_period',
        'KA006' => 'ledger_account_tree',
        'KA007' => 'ledger_period_tiling',
    ];

    public function __construct(public readonly string $sqlState, QueryException $previous)
    {
        $message = Messages::get(self::CODES[$sqlState] ?? 'ledger_unbalanced');

        parent::__construct(ErrorCode::ValidationError, $message, ['ledger' => [$message]], previous: $previous);
    }

    public static function sqlState(QueryException $e): ?string
    {
        $state = $e->errorInfo[0] ?? $e->getCode();

        return is_string($state) && isset(self::CODES[$state]) ? $state : null;
    }
}
