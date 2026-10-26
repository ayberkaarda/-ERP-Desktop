<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Data;

final readonly class TreasuryInvoicePageData
{
    /** @param list<TreasuryInvoiceData> $items */
    public function __construct(public array $items, public int $total, public int $page, public int $perPage) {}
}
