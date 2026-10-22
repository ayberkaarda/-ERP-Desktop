<?php

declare(strict_types=1);

// Labels of the purchasing settings (shown as settings::registry.<key>).
return [
    'purchasing.allow_direct_receipt' => 'Allow goods receipts without an order',
    'purchasing.match_mode' => 'Three-way match',
    'purchasing.match_qty_tolerance_percent' => 'Match quantity tolerance (%)',
    'purchasing.match_price_tolerance_percent' => 'Match price tolerance (%)',
    'purchasing.allow_over_receipt_percent' => 'Allowed over-receipt percentage',
    'purchasing.require_approval_over' => 'Purchase orders above this amount need approval',
    'purchasing.request_approval_over' => 'Purchase requests above this amount need approval',
    'purchasing.invoice_approval_over' => 'Supplier invoices above this amount need approval',
    'purchasing.default_warehouse_id' => 'Default purchasing warehouse',
    'purchasing.rounding' => 'Purchasing document rounding',
];
