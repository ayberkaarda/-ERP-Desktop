<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Xid8;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Services\ReturnService;
use App\Modules\Sales\Sync\DocumentSyncResource;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sync;

// Committing database: pull reads only rows below the horizon, which a RefreshDatabase
// transaction never passes (tests/Support/Sync.php).
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
});

/**
 * Rows the resource would pull for the company, serialised like the pull does.
 *
 * @return list<array<string, mixed>>
 */
function salesPulled(string $resource, string $company, ?Xid8 $after = null, string|false|null $context = null): array
{
    $adapter = collect(app()->tagged(SyncResource::TAG))->first(fn (SyncResource $r): bool => $r->name() === $resource);
    $read = fn (): array => $adapter->query($company)
        ->whereRaw($adapter->positionColumn().' < pg_snapshot_xmin(pg_current_snapshot())')
        ->when($after !== null, fn ($q) => $q->whereRaw($adapter->positionColumn().' > ?::xid8', [(string) $after]))
        ->orderByRaw($adapter->positionColumn().', id')->get()
        ->map(fn ($doc): array => (new DocumentResource($doc))->resolve(new Request))->all();

    // $context: null = the pulled company, false = no active company, string = another company.
    if ($context === false) {
        app(CompanyContext::class)->clear();

        return $read();
    }

    return SalesKit::in($context ?? $company, $read);
}

/** @param  array<array-key, mixed>  $data */
function salesHasKeyDeep(array $data, string $key): bool
{
    foreach ($data as $k => $v) {
        if ($k === $key || (is_array($v) && salesHasKeyDeep($v, $key))) {
            return true;
        }
    }

    return false;
}

it('pulls the company documents in the REST list shape with lines, and never sync_txid', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2']]])->assertCreated()->json('data');
    $other = SalesKit::world(stock: false);
    $otherList = SalesKit::priceList($other->company, ['is_default' => true]);
    Catalog::line($other->company, $otherList, $other->item, $other->unit, '50');
    SalesKit::post($other->user, $other->company, 'sales-quotes', ['party_id' => $other->party->id, 'lines' => [['item_id' => $other->item->id, 'quantity' => '1']]])->assertCreated();

    Sync::awaitHorizonPast(Sync::txidOf('sales_quotes', $quote['id']));
    $pulled = salesPulled('sales-quotes', $this->w->company);

    $index = SalesKit::get($this->w->user, $this->w->company, 'sales-quotes')->assertOk()->json('data.0');
    $show = SalesKit::get($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}")->assertOk()->json('data');

    expect($pulled)->toHaveCount(1)
        ->and($pulled[0]['id'])->toBe($quote['id'])
        ->and(array_keys($pulled[0]))->toBe([...array_keys($index), 'lines'])
        ->and(array_diff_key($pulled[0], ['lines' => true]))->toBe($index)
        ->and($pulled[0]['lines'])->toBe($show['lines'])
        ->and(salesHasKeyDeep($pulled, 'sync_txid'))->toBeFalse()
        ->and(salesHasKeyDeep($index, 'sync_txid'))->toBeFalse()
        ->and(salesHasKeyDeep($show, 'sync_txid'))->toBeFalse();
});

it('keeps sync_txid out of every sales document response', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);

    foreach (['sales-orders' => $order, 'sales-deliveries' => $delivery, 'sales-invoices' => $invoice] as $path => $doc) {
        $index = SalesKit::get($this->w->user, $this->w->company, $path)->assertOk()->json();
        $show = SalesKit::get($this->w->user, $this->w->company, "{$path}/{$doc['id']}")->assertOk()->json();
        expect(salesHasKeyDeep($index, 'sync_txid'))->toBeFalse()->and(salesHasKeyDeep($show, 'sync_txid'))->toBeFalse()
            ->and(salesHasKeyDeep($doc, 'sync_txid'))->toBeFalse();
    }

    expect(DB::table('sales_orders')->where('id', $order['id'])->value('sync_txid'))->not->toBeNull();
});

it('moves a document in the pull when only its lines change, and when a delivery updates order lines', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $before = Sync::txidOf('sales_orders', $order['id']);

    // Posting the delivery writes delivered_quantity on the order line only.
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '1']);
    $after = Sync::txidOf('sales_orders', $order['id']);

    expect($after->greaterThan($before))->toBeTrue()
        ->and(Sync::txidOf('sales_deliveries', $delivery['id'])->greaterThan($before))->toBeTrue();

    Sync::awaitHorizonPast($after);
    $pulled = collect(salesPulled('sales-orders', $this->w->company))->firstWhere('id', $order['id']);
    expect($pulled['lines'][0]['delivered_quantity'])->toBe('1.000000');

    // A raw line edit (no header write) also touches the header, without a version step.
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id,
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2']]])->json('data');
    $q1 = Sync::txidOf('sales_quotes', $quote['id']);
    DB::table('sales_quote_lines')->where('document_id', $quote['id'])->update(['description' => 'Edited']);
    expect(Sync::txidOf('sales_quotes', $quote['id'])->greaterThan($q1))->toBeTrue()
        ->and(DB::table('sales_quotes')->where('id', $quote['id'])->value('version'))->toBe(1);
});

it('leaves a tombstone for a deleted draft and none for its lines', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id,
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2']]])->json('data');
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-quotes/{$quote['id']}")->assertNoContent();

    $tomb = Sync::tombstone('sales_quotes', $quote['id']);
    expect($tomb)->not->toBeNull()
        ->and($tomb->company_id)->toBe($this->w->company)
        ->and($tomb->reason)->toBe('deleted')
        ->and(DB::table('sync_tombstones')->where('resource_table', 'sales_quote_lines')->count())->toBe(0)
        ->and(DocumentSyncResource::for('sales-quotes')->table())->toBe('sales_quotes');
});

it('lets the parent touch through the posted delivery guard and nothing else', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '1']);
    $before = Sync::txidOf('sales_deliveries', $delivery['id']);

    DB::transaction(function () use ($delivery): void {
        DB::select("SELECT set_config('keystone.sync_touch', 'on', true)");
        DB::table('sales_deliveries')->where('id', $delivery['id'])->update(['sync_txid' => DB::raw('sync_txid')]);
        DB::select("SELECT set_config('keystone.sync_touch', '', true)");
    });
    expect(Sync::txidOf('sales_deliveries', $delivery['id'])->greaterThan($before))->toBeTrue();

    // The flag alone does not open the guard: with it on, any data change is still refused.
    foreach ([['notes' => 'changed'], ['total' => '1'], ['status' => 'draft']] as $change) {
        expect(fn () => DB::transaction(function () use ($delivery, $change): void {
            DB::select("SELECT set_config('keystone.sync_touch', 'on', true)");
            DB::table('sales_deliveries')->where('id', $delivery['id'])->update($change);
        }))->toThrow(QueryException::class, 'cannot be changed');
    }
    expect(DB::table('sales_deliveries')->where('id', $delivery['id'])->value('status'))->toBe('posted');

    expect(fn () => DB::table('sales_deliveries')->where('id', $delivery['id'])->update(['notes' => 'changed']))
        ->toThrow(QueryException::class, 'cannot be changed');
    expect(fn () => DB::table('sales_delivery_lines')->where('document_id', $delivery['id'])->update(['description' => 'x']))
        ->toThrow(QueryException::class, 'immutable');
});

it('limits the pull by the window field and loads the manifest embeds', function (): void {
    foreach (DocumentSyncResource::RESOURCES as $name => $model) {
        $resource = DocumentSyncResource::for($name);
        $sql = SalesKit::in($this->w->company, fn (): string => $resource->query($this->w->company)->toSql());

        expect($resource->windowField())->toBe('document_date')
            ->and($resource->positionColumn())->toBe((new $model)->getTable().'.sync_txid')
            ->and($resource->parentKey())->toBeNull()
            ->and($sql)->toContain('"company_id" = ?');
    }
});

it('reads lines and line_count for the explicit company whatever the ambient context', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id,
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2'], ['item_id' => $this->w->item->id, 'quantity' => '1']]])->assertCreated()->json('data');
    $other = SalesKit::world(stock: false);
    Sync::awaitHorizonPast(Sync::txidOf('sales_quotes', $quote['id']));

    $own = salesPulled('sales-quotes', $this->w->company);
    expect($own[0]['line_count'])->toBe(2);

    foreach ([false, $other->company] as $context) {
        $pulled = salesPulled('sales-quotes', $this->w->company, context: $context);
        expect($pulled)->toHaveCount(1)
            ->and($pulled[0]['line_count'])->toBe(2)
            ->and($pulled[0]['lines'])->toHaveCount(2)
            ->and($pulled)->toBe($own);
    }
});

it('moves the invoice in an incremental pull when a serial return is created, cancelled or deleted', function (): void {
    $serial = SalesKit::item($this->w->company, ['code' => 'PHONE', 'tracking' => 'serial', 'default_tax_code_id' => $this->w->vat->id], $this->w->unit);
    SalesKit::receive($this->w->company, $this->w->wh->id, $serial->id, '2', '100', ['serials' => ['S1', 'S2']]);
    $order = SalesKit::confirmedOrder($this->w, [[$serial->id, '2', '300']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", [
        'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '2', 'serial_numbers' => ['S1', 'S2']]],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk();
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $line = $invoice['lines'][0]['id'];
    $kept = fn (): array => (array) DB::table('sales_invoices')->where('id', $invoice['id'])->select('version', 'updated_at')->first();
    $pullAfter = function (Xid8 $cursor) use ($invoice): array {
        Sync::awaitHorizonPast(Sync::txidOf('sales_invoices', $invoice['id']));

        return collect(salesPulled('sales-invoices', $this->w->company, $cursor))->where('id', $invoice['id'])->values()->all();
    };
    $returnOf = fn (string $serial) => SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $line, 'quantity' => '1', 'serial_numbers' => [$serial]]],
    ])->assertCreated()->json('data');

    $cursor = Sync::txidOf('sales_invoices', $invoice['id']);
    Sync::awaitHorizonPast($cursor);
    expect(salesPulled('sales-invoices', $this->w->company, $cursor))->toBe([]);
    $before = $kept();

    // Created: the invoice moves and S1 is no longer returnable; version and updated_at stay.
    $return = $returnOf('S1');
    $pulled = $pullAfter($cursor);
    expect($pulled)->toHaveCount(1)->and($pulled[0]['lines'][0]['returnable_serials'])->toBe(['S2'])->and($kept())->toBe($before);

    // Cancelled: S1 is returnable again.
    $cursor = Sync::txidOf('sales_invoices', $invoice['id']);
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/cancel", ['reason' => 'Wrong serial'])->assertOk();
    $pulled = $pullAfter($cursor);
    expect($pulled)->toHaveCount(1)->and($pulled[0]['lines'][0]['returnable_serials'])->toBe(['S1', 'S2'])->and($kept())->toBe($before);

    // A draft return deleted: the invoice moves again.
    $draft = $returnOf('S2');
    $cursor = Sync::txidOf('sales_invoices', $invoice['id']);
    Sync::awaitHorizonPast($cursor);
    expect($pullAfter(Xid8::zero())[0]['lines'][0]['returnable_serials'])->toBe(['S1']);
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-returns/{$draft['id']}")->assertNoContent();
    $pulled = $pullAfter($cursor);
    expect($pulled)->toHaveCount(1)->and($pulled[0]['lines'][0]['returnable_serials'])->toBe(['S1', 'S2'])->and($kept())->toBe($before);
});

it('computes returnable_serials for the invoice company whatever the ambient context', function (): void {
    $serial = SalesKit::item($this->w->company, ['code' => 'PHONE', 'tracking' => 'serial', 'default_tax_code_id' => $this->w->vat->id], $this->w->unit);
    SalesKit::receive($this->w->company, $this->w->wh->id, $serial->id, '2', '100', ['serials' => ['S1', 'S2']]);
    $order = SalesKit::confirmedOrder($this->w, [[$serial->id, '2', '300']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", [
        'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '2', 'serial_numbers' => ['S1', 'S2']]],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk();
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1', 'serial_numbers' => ['S1']]],
    ])->assertCreated();
    $other = SalesKit::world(stock: false);
    Sync::awaitHorizonPast(Sync::txidOf('sales_invoices', $invoice['id']));

    $show = SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}")->assertOk()->json('data.lines.0.returnable_serials');
    expect($show)->toBe(['S2']);

    foreach ([null, false, $other->company] as $context) {
        $pulled = collect(salesPulled('sales-invoices', $this->w->company, context: $context))->firstWhere('id', $invoice['id']);
        expect($pulled['lines'][0]['returnable_serials'])->toBe(['S2'], 'context: '.var_export($context, true));
    }

    // The resource on its own, outside any company and inside another one.
    $doc = SalesKit::in($this->w->company, fn () => SalesInvoice::query()->with('lines')->findOrFail($invoice['id']));
    $serials = fn (): mixed => (new DocumentResource($doc))->resolve(new Request)['lines'][0]['returnable_serials'];
    expect(SalesKit::in($other->company, $serials))->toBe(['S2']);
    app(CompanyContext::class)->clear();
    expect($serials())->toBe(['S2']);
});

it('locks the invoice before the return on every return path', function (string $path): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');

    if ($path === 'receive') {
        SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/approve")->assertOk();
    }

    $locks = [];
    DB::listen(function ($query) use (&$locks): void {
        if (str_contains($query->sql, 'for update') && preg_match('/from "(sales_invoices|sales_returns)"/', $query->sql, $m) === 1) {
            $locks[] = $m[1];
        }
    });

    $response = match ($path) {
        'delete' => SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-returns/{$return['id']}"),
        default => SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/{$path}", ['reason' => 'x']),
    };
    expect($response->status())->toBeLessThan(300)
        ->and(array_values(array_unique($locks)))->toBe(['sales_invoices', 'sales_returns']);
})->with(['cancel', 'delete', 'receive']);

it('does not deadlock a return cancel against an invoice-first path', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '120']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');

    // A second connection holds the invoice row, as an invoice-first path (update, approve, credit) does.
    $config = config('database.connections.'.config('database.default'));
    config(['database.connections.sales_lock_probe' => $config]);
    $other = DB::connection('sales_lock_probe');
    $other->beginTransaction();
    $other->select('select id from sales_invoices where id = ? for update', [$invoice['id']]);

    // The cancel must wait on the invoice before it holds the return. Under a short lock_timeout it
    // fails on that first SELECT ... FOR UPDATE of the invoice; locking the return first would fail
    // later, inside the UPDATE of sales_returns whose trigger touches the invoice (the deadlock path).
    DB::statement("SET lock_timeout = '300ms'");
    $failed = null;
    try {
        SalesKit::in($this->w->company, fn () => app(ReturnService::class)->cancel(SalesReturn::query()->findOrFail($return['id']), null, $this->w->user));
    } catch (QueryException $e) {
        $failed = $e;
    } finally {
        DB::statement('SET lock_timeout = 0');
        $other->rollBack();
        DB::disconnect('sales_lock_probe');
    }

    expect($failed)->not->toBeNull()
        ->and($failed->errorInfo[0] ?? null)->toBe('55P03')
        ->and($failed->getSql())->toContain('from "sales_invoices"')->toContain('for update')
        ->and(DB::table('sales_returns')->where('id', $return['id'])->value('status'))->toBe('draft');

    // Released: the cancel goes through.
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/cancel", ['reason' => 'x'])->assertOk()->assertJsonPath('data.status', 'cancelled');
});

/**
 * A credited return: invoice, received return and its issued credit note.
 *
 * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: string}
 */
function salesCreditedReturn(object $w): array
{
    $order = SalesKit::confirmedOrder($w, [[$w->item->id, '2', '120']]);
    $delivery = SalesKit::deliver($w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($w, $delivery['id']);
    $return = SalesKit::post($w->user, $w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    SalesKit::post($w->user, $w->company, "sales-returns/{$return['id']}/approve")->assertOk();
    SalesKit::post($w->user, $w->company, "sales-returns/{$return['id']}/receive")->assertOk();
    $note = SalesKit::post($w->user, $w->company, "sales-returns/{$return['id']}/credit")->assertOk()->json('data.credit_invoice_id');

    return [$invoice, $return, $note];
}

it('locks the original invoice before the return when a credit note is reversed', function (): void {
    [$invoice, $return, $note] = salesCreditedReturn($this->w);

    $locks = [];
    DB::listen(function ($query) use (&$locks, $invoice, $return): void {
        if (str_contains($query->sql, 'for update')) {
            foreach (['original' => $invoice['id'], 'return' => $return['id']] as $name => $id) {
                if (in_array($id, $query->bindings, true)) {
                    $locks[] = $name;
                }
            }
        }
    });

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$note}/reverse", ['reason' => 'Wrong credit', 'date' => SalesKit::TODAY])
        ->assertOk()->assertJsonPath('data.status', 'reversed');

    expect(array_values(array_unique($locks)))->toBe(['original', 'return'])
        ->and(DB::table('sales_returns')->where('id', $return['id'])->value('status'))->toBe('received');
});

it('waits on the original invoice, before holding the return, when a credit note is reversed', function (): void {
    [$invoice, $return, $note] = salesCreditedReturn($this->w);

    // A second connection holds the original invoice, as ReturnService credit/receive do first.
    config(['database.connections.sales_lock_probe' => config('database.connections.'.config('database.default'))]);
    $other = DB::connection('sales_lock_probe');
    $other->beginTransaction();
    $other->select('select id from sales_invoices where id = ? for update', [$invoice['id']]);

    // Fails on the explicit lock of the original invoice; the return-first order would fail
    // later, inside the UPDATE of sales_returns whose trigger touches that invoice.
    DB::statement("SET lock_timeout = '300ms'");
    $failed = null;
    try {
        SalesKit::in($this->w->company, fn () => app(InvoiceService::class)->reverse(SalesInvoice::query()->findOrFail($note), null, SalesKit::TODAY, 'Wrong credit', false, $this->w->user));
    } catch (QueryException $e) {
        $failed = $e;
    } finally {
        DB::statement('SET lock_timeout = 0');
        $other->rollBack();
        DB::disconnect('sales_lock_probe');
    }

    expect($failed)->not->toBeNull()
        ->and($failed->errorInfo[0] ?? null)->toBe('55P03')
        ->and($failed->getSql())->toContain('from "sales_invoices"')->toContain('for update')
        ->and($failed->getBindings())->toContain($invoice['id'])
        ->and(DB::table('sales_invoices')->where('id', $note)->value('status'))->toBe('issued');
});
