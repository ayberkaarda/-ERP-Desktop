<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

final readonly class SalesInvoicePage
{
    /** @param list<SalesInvoiceData> $items */
    public function __construct(public array $items, public int $total, public int $page, public int $perPage) {}
}
