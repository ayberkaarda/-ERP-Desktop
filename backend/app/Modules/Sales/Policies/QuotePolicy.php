<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

/** send, accept, reject, revise, cancel and convert are edits of the quote (convert also needs sales.orders.create). */
final class QuotePolicy extends SalesPolicy
{
    protected function resource(): string
    {
        return 'quotes';
    }
}
