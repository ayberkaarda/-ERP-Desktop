<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Purchasing documents become visible to sync pull: every header table gets its own sync position
 * and tombstones, every line table touches its header (lines are embedded, not separate
 * resources). RFQ suppliers and quotes are not part of the offline shape (embeds: lines), so they
 * are left alone.
 *
 * Guards: purchase_invoices_guard and purchase_receipts_guard refuse updates of booked/posted
 * rows, but a header is only touched by a line change and the line guards (KP002, KP003) refuse
 * line changes of those same documents first, so neither guard needs the sync_touching() escape.
 */
return new class extends Migration
{
    /** @var array<string, string> header table => line table */
    private const array DOCUMENTS = [
        'purchase_requests' => 'purchase_request_lines',
        'purchase_rfqs' => 'purchase_rfq_lines',
        'purchase_orders' => 'purchase_order_lines',
        'purchase_receipts' => 'purchase_receipt_lines',
        'purchase_invoices' => 'purchase_invoice_lines',
        'purchase_returns' => 'purchase_return_lines',
    ];

    public function up(): void
    {
        foreach (self::DOCUMENTS as $header => $lines) {
            Schema::table($header, static function (Blueprint $t): void {
                $t->syncable();
            });
            Schema::table($lines, static function (Blueprint $t) use ($header): void {
                $t->syncable(parent: $header, parentKey: ['document_id']);
            });
        }
    }

    public function down(): void
    {
        foreach (self::DOCUMENTS as $header => $lines) {
            Schema::table($lines, static function (Blueprint $t) use ($header): void {
                $t->dropSyncable(parent: $header);
            });
            Schema::table($header, static function (Blueprint $t): void {
                $t->dropSyncable();
            });
        }
    }
};
