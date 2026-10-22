<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Exceptions;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Purchasing\Support\Messages;
use Illuminate\Database\QueryException;

/**
 * A purchasing invariant raised by the database (trigger class KP, or the unique supplier invoice
 * number index), as a 422.
 */
final class PurchasingViolation extends ApiException
{
    /** SQLSTATE => message key. */
    public const array CODES = [
        'KP001' => 'violation_invoice_immutable',
        'KP002' => 'violation_invoice_lines_immutable',
        'KP003' => 'violation_receipt_immutable',
        '23505' => 'supplier_invoice_duplicate',
    ];

    public function __construct(public readonly string $sqlState, QueryException $previous)
    {
        $message = Messages::get(self::CODES[$sqlState] ?? 'violation_invoice_immutable', ['number' => '']);
        $field = $sqlState === '23505' ? 'supplier_invoice_no' : 'document';

        parent::__construct(ErrorCode::ValidationError, $message, [$field => [$message]], previous: $previous);
    }

    public static function sqlState(QueryException $e): ?string
    {
        $state = $e->errorInfo[0] ?? $e->getCode();

        if (! is_string($state) || ! isset(self::CODES[$state])) {
            return null;
        }

        // Only the supplier invoice number index is ours among unique violations.
        return $state !== '23505' || str_contains($e->getMessage(), 'purchase_invoices_supplier_no_unique') ? $state : null;
    }
}
