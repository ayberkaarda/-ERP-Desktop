<?php

declare(strict_types=1);

use App\Modules\Sales\Exceptions\SalesViolation;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

/*
 * KS005: an order that delivery or invoicing started from (or a closed or cancelled one) is
 * immutable in the database too, not only in OrderService. Only its status moves, and its lines
 * only take delivered/invoiced quantities and reservation links; raw SQL cannot rewrite it.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
    $this->order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $this->line = $this->order['lines'][0]['id'];
});

function orderRefused(Closure $statement): void
{
    // A savepoint per statement: the refused statement must not abort the test transaction.
    expect(fn () => DB::transaction($statement))->toThrow(fn (QueryException $e) => expect($e->errorInfo[0] ?? null)->toBe('KS005', $e->getMessage()));
}

it('freezes a delivered order and its lines against raw SQL', function (): void {
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '1']);
    $order = $this->order['id'];

    orderRefused(fn () => DB::table('sales_orders')->where('id', $order)->update(['party_name' => 'Forged']));
    orderRefused(fn () => DB::table('sales_orders')->where('id', $order)->update(['total' => '1.0000', 'version' => DB::raw('version + 1')]));
    orderRefused(fn () => DB::table('sales_orders')->where('id', $order)->delete());
    orderRefused(fn () => DB::table('sales_order_lines')->where('id', $this->line)->update(['unit_price' => '1']));
    orderRefused(fn () => DB::table('sales_order_lines')->where('id', $this->line)->delete());
    orderRefused(fn () => DB::table('sales_order_lines')->insert([
        ...(array) DB::table('sales_order_lines')->where('id', $this->line)->first(),
        'id' => (string) Str::uuid7(), 'line_no' => 9, 'reservation_id' => null,
    ]));

    // The touch flag does not open it either.
    DB::statement("SELECT set_config('keystone.sync_touch', 'on', true)");
    orderRefused(fn () => DB::table('sales_orders')->where('id', $order)->update(['notes' => 'Forged']));
    DB::statement("SELECT set_config('keystone.sync_touch', '', true)");

    expect(DB::table('sales_orders')->where('id', $order)->value('party_name'))->not->toBe('Forged');
});

it('still lets progress, status and the sync touch through', function (): void {
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '1']);
    $order = $this->order['id'];

    DB::table('sales_order_lines')->where('id', $this->line)->update(['delivered_quantity' => '2', 'reservation_id' => null]);
    DB::table('sales_orders')->where('id', $order)->update(['status' => 'delivered', 'version' => DB::raw('version + 1'), 'updated_at' => now()]);

    expect(DB::table('sales_orders')->where('id', $order)->value('status'))->toBe('delivered');
});

it('refuses status moves the order machine does not allow once documents exist', function (string $to): void {
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '1']);
    $order = $this->order['id'];

    // Back to an editable state would reopen the free branches of both guards.
    orderRefused(fn () => DB::table('sales_orders')->where('id', $order)->update(['status' => $to]));

    expect(DB::table('sales_orders')->where('id', $order)->value('status'))->toBe('partially_delivered');
    orderRefused(fn () => DB::table('sales_order_lines')->where('id', $this->line)->update(['unit_price' => '1']));
})->with(['draft', 'pending_approval', 'cancelled']);

it('freezes closed and cancelled orders', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->order['id']}/close")->assertOk();
    $cancelled = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$cancelled['id']}/cancel")->assertOk();

    foreach ([$this->order['id'], $cancelled['id']] as $id) {
        orderRefused(fn () => DB::table('sales_orders')->where('id', $id)->update(['notes' => 'Forged']));
        orderRefused(fn () => DB::table('sales_orders')->where('id', $id)->update(['status' => 'confirmed']));
    }

    orderRefused(fn () => DB::table('sales_order_lines')->where('document_id', $cancelled['id'])->update(['quantity' => '5']));

    // Progress still follows a later reversal; its parent touch passes the closed header.
    // (A position from an earlier transaction, so the touch really updates the header.)
    DB::statement('SET LOCAL session_replication_role = replica');
    DB::table('sales_orders')->where('id', $this->order['id'])->update(['sync_txid' => DB::raw("'1'::xid8")]);
    DB::statement('SET LOCAL session_replication_role = origin');
    DB::table('sales_order_lines')->where('id', $this->line)->update(['delivered_quantity' => '0']);

    expect(DB::table('sales_orders')->where('id', $this->order['id'])->value('status'))->toBe('closed')
        ->and(DB::table('sales_orders')->where('id', $this->order['id'])->value('sync_txid'))->not->toBe('1');
});

it('keeps drafts and confirmed orders without documents editable', function (): void {
    // A confirmed order nothing was delivered or invoiced from can be revised (OrderService::revise).
    DB::table('sales_order_lines')->where('id', $this->line)->update(['quantity' => '3', 'base_quantity' => '3']);
    DB::table('sales_orders')->where('id', $this->order['id'])->update(['notes' => 'Revised']);

    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1']],
    ])->assertCreated()->json('data');
    DB::table('sales_orders')->where('id', $draft['id'])->update(['notes' => 'Free']);
    DB::table('sales_orders')->where('id', $draft['id'])->delete();

    expect(DB::table('sales_orders')->where('id', $this->order['id'])->value('notes'))->toBe('Revised')
        ->and(DB::table('sales_orders')->where('id', $draft['id'])->exists())->toBeFalse();
});

it('maps the violation to a sales validation error', function (): void {
    SalesKit::deliver($this->w, $this->order['id'], [$this->line => '1']);

    expect(fn () => DB::transaction(fn () => DB::table('sales_orders')->where('id', $this->order['id'])->update(['party_name' => 'Forged'])))
        ->toThrow(function (QueryException $e): void {
            expect(SalesViolation::sqlState($e))->toBe('KS005')
                ->and((new SalesViolation('KS005', $e))->getMessage())->toBe(__('sales::messages.violation_order_immutable'));
        });
});
