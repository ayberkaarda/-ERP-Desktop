<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

/*
 * The order line guard (KS005) reads the order status under a share lock taken with NOWAIT: a
 * line change never decides on a status another transaction is about to change (for example a
 * close in flight), and it never waits behind that transaction either. Committing database: the
 * other transaction runs on its own connection.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
    $this->order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $this->line = $this->order['lines'][0]['id'];
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '1']);
    config(['database.connections.sales_order_holder' => config('database.connections.'.config('database.default'))]);
});

afterEach(function (): void {
    DB::disconnect('sales_order_holder');
});

it('refuses a line change at once while another transaction holds the order', function (): void {
    $holder = DB::connection('sales_order_holder');
    $holder->beginTransaction();
    // Like OrderService::close: the order row is locked, its status about to become closed.
    $holder->select('select id from sales_orders where id = ? for update', [$this->order['id']]);
    DB::statement("SET lock_timeout = '2s'");
    $state = null;
    $started = microtime(true);

    try {
        DB::table('sales_order_lines')->where('id', $this->line)->update(['delivered_quantity' => '2']);
    } catch (QueryException $e) {
        $state = $e->errorInfo[0] ?? null;
    } finally {
        DB::statement('SET lock_timeout = 0');
        $holder->rollBack();
    }

    expect($state)->toBe('55P03')
        ->and(microtime(true) - $started)->toBeLessThan(1.5)
        ->and((string) DB::table('sales_order_lines')->where('id', $this->line)->value('delivered_quantity'))->toBe('1.000000');
});

it('lets the same change through once the order is free', function (): void {
    DB::table('sales_order_lines')->where('id', $this->line)->update(['delivered_quantity' => '2']);

    expect((string) DB::table('sales_order_lines')->where('id', $this->line)->value('delivered_quantity'))->toBe('2.000000');
});
