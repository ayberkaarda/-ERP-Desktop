<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Offline sync position for stock documents: the header is tracked, its lines touch it.
 *
 * stock_movements, stock_balances, stock_valuations and the other ledger tables stay as they
 * are: the movements are append-only (KI001, including TRUNCATE) and balances are snapshots
 * served from the REST read model, so neither is a sync resource.
 *
 * Guards on stock_documents (KI005) are BEFORE triggers that sort before zz_sync_touch, so
 * they compare to_jsonb(OLD) and to_jsonb(NEW) with sync_txid still unchanged. A line change
 * touches its parent only while the parent is a draft: the lines guard refuses every change
 * under a posted or cancelled document before the touch can happen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_documents', function (Blueprint $table): void {
            $table->syncable();
        });

        Schema::table('stock_document_lines', function (Blueprint $table): void {
            $table->syncable(parent: 'stock_documents', parentKey: ['document_id']);
        });
    }

    public function down(): void
    {
        Schema::table('stock_document_lines', function (Blueprint $table): void {
            $table->dropSyncable(parent: 'stock_documents');
        });

        Schema::table('stock_documents', function (Blueprint $table): void {
            $table->dropSyncable();
        });
    }
};
