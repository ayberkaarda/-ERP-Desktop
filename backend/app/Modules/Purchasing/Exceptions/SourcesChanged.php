<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Exceptions;

use RuntimeException;

/**
 * The sources of an invoice (its orders and receipts) changed between the unlocked read and the
 * invoice lock. The transaction is rolled back and retried; locking the new sources while holding
 * the invoice would invert the receipt -> invoice lock order.
 */
final class SourcesChanged extends RuntimeException
{
    public function __construct(public readonly int $version)
    {
        parent::__construct('purchase invoice sources changed while locking');
    }
}
