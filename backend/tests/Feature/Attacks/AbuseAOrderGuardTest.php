<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Sales\SalesKit;

/*
 * Abuse group A / 3: the KS005 database guard of sales orders (sales_orders_guard /
 * sales_order_lines_guard), attacked with raw SQL, i.e. by any code path or job that writes the
 * tables without OrderService (a buggy writer, a future sync adapter, a maintenance script).
 * The guard is the last line: it must refuse every change OrderService itself would refuse.
 * Orders are built through the real REST endpoints. Committed database (SyncDatabase), so a
 * second connection can hold locks for the race tests. Safe behaviour asserted; red = finding.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    config(['database.connections.abuse_a_holder' => config('database.connections.'.config('database.default'))]);
});

afterEach(function (): void {
    DB::statement('SET lock_timeout = 0');
    DB::disconnect('abuse_a_holder');
});

/**
 * Runs one raw statement; returns 'ok' or the SQLSTATE it was refused with.
 *
 * @param  list<mixed>  $bindings
 */
function abuseARaw(string $sql, array $bindings = []): string
{
    try {
        DB::statement($sql, $bindings);

        return 'ok';
    } catch (QueryException $e) {
        return (string) ($e->errorInfo[0] ?? 'error');
    }
}

/** @return array{order: array<string, mixed>, line: string} */
function abuseAConfirmed(object $test, string $qty = '5'): array
{
    $order = SalesKit::confirmedOrder($test->w, [[$test->w->item->id, $qty, '100']]);

    return ['order' => $order, 'line' => (string) $order['lines'][0]['id']];
}

function abuseAStatus(string $orderId): string
{
    return (string) DB::table('sales_orders')->where('id', $orderId)->value('status');
}

it('ABA-ORD-01 refuses a raw confirmed -> cancelled while a draft delivery references the order', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", [
        'document_date' => '2027-06-12', 'lines' => [['order_line_id' => $line, 'quantity' => '2']],
    ])->assertCreated();

    // The service refuses (an active document references the order).
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/cancel")
        ->assertStatus(422);

    // The guard must refuse the same change written past the service.
    $outcome = abuseARaw("UPDATE sales_orders SET status = 'cancelled', cancelled_at = now(), version = version + 1 WHERE id = ?", [$order['id']]);

    expect($outcome)->toBe('KS005', 'status now: '.abuseAStatus($order['id']));
});

it('ABA-ORD-02 refuses a raw step back from delivered to confirmed (and on to cancelled)', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    SalesKit::deliver($this->w, $order['id'], [$line => '5']);
    expect(abuseAStatus($order['id']))->toBe('delivered');

    // The quantities say delivered; the status is moved back without any reversal.
    $back = abuseARaw("UPDATE sales_orders SET status = 'confirmed', version = version + 1 WHERE id = ?", [$order['id']]);
    $cancel = $back === 'ok'
        ? abuseARaw("UPDATE sales_orders SET status = 'cancelled', cancelled_at = now(), version = version + 1 WHERE id = ?", [$order['id']])
        : 'not reached';

    expect($back)->toBe('KS005', "then cancel: {$cancel}, status now: ".abuseAStatus($order['id']));
});

it('ABA-ORD-03 refuses every other forbidden order transition and header change', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    SalesKit::deliver($this->w, $order['id'], [$line => '5']);
    $id = $order['id'];
    $other = SalesKit::party($this->w->company, ['name' => 'Other customer']);

    $outcomes = [
        'delivered->draft' => abuseARaw("UPDATE sales_orders SET status = 'draft' WHERE id = ?", [$id]),
        'delivered->pending_approval' => abuseARaw("UPDATE sales_orders SET status = 'pending_approval' WHERE id = ?", [$id]),
        'delivered->cancelled' => abuseARaw("UPDATE sales_orders SET status = 'cancelled' WHERE id = ?", [$id]),
        'party change' => abuseARaw('UPDATE sales_orders SET party_id = ? WHERE id = ?', [$other->id, $id]),
        'total change' => abuseARaw('UPDATE sales_orders SET tax_total = tax_total + 1, total = total + 1 WHERE id = ?', [$id]),
        'delete' => abuseARaw('DELETE FROM sales_orders WHERE id = ?', [$id]),
    ];

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$id}/close")->assertOk();
    $outcomes['closed->delivered'] = abuseARaw("UPDATE sales_orders SET status = 'delivered' WHERE id = ?", [$id]);
    $outcomes['closed->closed note'] = abuseARaw("UPDATE sales_orders SET notes = 'x' WHERE id = ?", [$id]);

    $cancelled = abuseAConfirmed($this, '1')['order'];
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$cancelled['id']}/cancel")->assertOk();
    $outcomes['cancelled->confirmed'] = abuseARaw("UPDATE sales_orders SET status = 'confirmed' WHERE id = ?", [$cancelled['id']]);

    expect(array_filter($outcomes, fn (string $o): bool => $o !== 'KS005'))->toBe([]);
});

it('ABA-ORD-04 refuses raw line changes of an order that a delivery references', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    SalesKit::deliver($this->w, $order['id'], [$line => '2']);
    $copy = (array) DB::table('sales_order_lines')->where('id', $line)->first();
    $copy['id'] = (string) Str::uuid7();
    $copy['line_no'] = 99;
    $columns = implode(', ', array_keys($copy));
    $marks = implode(', ', array_fill(0, count($copy), '?'));

    $outcomes = [
        'quantity' => abuseARaw('UPDATE sales_order_lines SET quantity = 1, base_quantity = 1 WHERE id = ?', [$line]),
        'price' => abuseARaw('UPDATE sales_order_lines SET unit_price = 1 WHERE id = ?', [$line]),
        'insert' => abuseARaw("INSERT INTO sales_order_lines ({$columns}) VALUES ({$marks})", array_values($copy)),
        'delete' => abuseARaw('DELETE FROM sales_order_lines WHERE id = ?', [$line]),
    ];

    expect(array_filter($outcomes, fn (string $o): bool => $o !== 'KS005'))->toBe([]);
});

it('ABA-ORD-05 refuses a raw line change while a delivery is being created for the order (no silent pass)', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    $holder = DB::connection('abuse_a_holder');
    $holder->beginTransaction();
    // DeliveryService::createFromOrder holds the order row while it reads the lines.
    $holder->select('SELECT id FROM sales_orders WHERE id = ? FOR UPDATE', [$order['id']]);

    try {
        $outcome = abuseARaw('UPDATE sales_order_lines SET quantity = 1, base_quantity = 1 WHERE id = ?', [$line]);
    } finally {
        $holder->rollBack();
    }

    expect($outcome)->toBe('55P03');
});

it('ABA-ORD-06 answers a delivery racing an open line edit with 409 and replays nothing twice on retry', function (): void {
    ['order' => $order, 'line' => $line] = abuseAConfirmed($this);
    $holder = DB::connection('abuse_a_holder');
    $holder->beginTransaction();
    // A line edit in flight: the line guard holds the order FOR SHARE until it commits.
    $holder->update('UPDATE sales_order_lines SET description = ? WHERE id = ?', ['edited in flight', $line]);
    DB::statement("SET lock_timeout = '300ms'");
    $key = (string) Str::uuid7();
    $body = ['document_date' => '2027-06-12', 'lines' => [['order_line_id' => $line, 'quantity' => '2']]];

    try {
        $busy = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", $body, $key);
    } finally {
        $holder->commit();
        DB::statement('SET lock_timeout = 0');
    }

    $busy->assertStatus(409)->assertHeader('Retry-After', '1')->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    expect(DB::table('sales_deliveries')->where('order_id', $order['id'])->count())->toBe(0);

    // Same key once the edit committed: created once, and a second replay creates nothing more.
    $first = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", $body, $key)->assertCreated();
    $again = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", $body, $key)->assertCreated();

    expect($again->headers->get('Idempotent-Replayed'))->not->toBeNull()
        ->and($again->json('data.id'))->toBe($first->json('data.id'))
        ->and(DB::table('sales_deliveries')->where('order_id', $order['id'])->count())->toBe(1);
});
