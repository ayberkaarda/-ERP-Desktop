<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Support;

final class ReturnWarehouse
{
    /**
     * Legacy null headers used the first stock line's source receipt warehouse when shipped.
     *
     * @return literal-string
     */
    public static function expression(): string
    {
        return <<<'SQL'
            coalesce(r.warehouse_id, (
                SELECT receipt.warehouse_id
                FROM purchase_return_lines source
                JOIN purchase_receipt_lines received ON received.id = source.receipt_line_id
                    AND received.company_id = source.company_id
                JOIN purchase_receipts receipt ON receipt.id = received.document_id
                    AND receipt.company_id = source.company_id
                WHERE source.document_id = r.id AND source.company_id = r.company_id
                    AND source.item_type = 'stock'
                ORDER BY source.line_no
                LIMIT 1
            ))
            SQL;
    }
}
