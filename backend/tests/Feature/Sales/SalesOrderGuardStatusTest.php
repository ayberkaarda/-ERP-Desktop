<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Sales\SalesKit;

/*
 * KS005 status transitions written past OrderService (raw SQL): the guard refuses every status
 * change the service refuses. An order that an active (draft) delivery references cannot be
 * cancelled, and an order whose quantities say delivered cannot step back to confirmed.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '5', '100']]);
    $this->line = (string) $this->order['lines'][0]['id'];
});

/**
 * Runs one raw statement in a savepoint; 'ok' or the SQLSTATE it was refused with.
 *
 * @param  list<mixed>  $bindings
 */
function guardStatusRaw(string $sql, array $bindings): string
{
    try {
        DB::transaction(static fn () => DB::statement($sql, $bindings));

        return 'ok';
    } catch (QueryException $e) {
        return (string) ($e->errorInfo[0] ?? 'error');
    }
}

function guardStatusOf(string $orderId): string
{
    return (string) DB::table('sales_orders')->where('id', $orderId)->value('status');
}

it('refuses a raw confirmed to cancelled while a draft delivery references the order', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->order['id']}/deliveries", [
        'document_date' => '2027-06-12', 'lines' => [['order_line_id' => $this->line, 'quantity' => '2']],
    ])->assertCreated();
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->order['id']}/cancel")->assertStatus(422);

    $outcome = guardStatusRaw("UPDATE sales_orders SET status = 'cancelled', cancelled_at = now(), version = version + 1 WHERE id = ?", [$this->order['id']]);

    expect($outcome)->toBe('KS005')
        ->and(guardStatusOf($this->order['id']))->toBe('confirmed');
});

it('refuses a raw step back from delivered to confirmed, so it cannot be cancelled after', function (): void {
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '5']);
    expect(guardStatusOf($this->order['id']))->toBe('delivered');

    $back = guardStatusRaw("UPDATE sales_orders SET status = 'confirmed', version = version + 1 WHERE id = ?", [$this->order['id']]);

    expect($back)->toBe('KS005')
        ->and(guardStatusOf($this->order['id']))->toBe('delivered');
});

it('refuses a raw progress status a confirmed order without documents and with zero quantities does not have', function (): void {
    $outcomes = [];

    foreach (['invoiced', 'partially_invoiced', 'delivered', 'partially_delivered'] as $status) {
        $outcomes[$status] = guardStatusRaw('UPDATE sales_orders SET status = ?, version = version + 1 WHERE id = ?', [$status, $this->order['id']]);
    }

    expect($outcomes)->toBe(['invoiced' => 'KS005', 'partially_invoiced' => 'KS005', 'delivered' => 'KS005', 'partially_delivered' => 'KS005'])
        ->and(guardStatusOf($this->order['id']))->toBe('confirmed');

    // The order is still free to revise while nothing references it.
    expect(guardStatusRaw("UPDATE sales_orders SET notes = 'revised', version = version + 1 WHERE id = ?", [$this->order['id']]))->toBe('ok');
});

it('still lets the service cancel a confirmed order with no active document', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->order['id']}/cancel")->assertOk();

    expect(guardStatusOf($this->order['id']))->toBe('cancelled');
});
