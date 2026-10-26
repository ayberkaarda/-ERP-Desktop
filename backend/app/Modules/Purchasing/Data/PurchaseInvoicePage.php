<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Data;

final readonly class PurchaseInvoicePage
{
    /** @param list<PurchaseInvoiceData> $items */
    public function __construct(public array $items, public int $total, public int $page, public int $perPage) {}
}
