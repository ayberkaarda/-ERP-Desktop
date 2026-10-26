<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Documents\VersionConflictException;
use App\Core\Sync\Contracts\SyncResource;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\ReturnService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->resources = collect(iterator_to_array(app()->tagged(SyncResource::TAG)))->keyBy(static fn (SyncResource $r): string => $r->name());
    app(CompanyContext::class)->clear();
});

/**
 * Rows of the adapter below the pull horizon, as PullService reads them.
 *
 * @return list<string>
 */
function pulledIds(SyncResource $resource, string $company): array
{
    return $resource->query($company)
        ->whereRaw("{$resource->positionColumn()} < ?::xid8", [Sync::horizon()->value])
        ->orderByRaw("{$resource->positionColumn()}, {$resource->table()}.id")
        ->pluck($resource->table().'.id')->all();
}

it('serves a committed request with its lines to its own company only', function (): void {
    $w = $this->w;
    $id = PurchKit::post($w->user, $w->company, 'purchase-requests', [
        'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'estimated_price' => '5']],
    ])->assertCreated()->json('data.id');
    $resource = $this->resources['purchase-requests'];
    Sync::awaitHorizonPast(Sync::txidOf('purchase_requests', $id));

    expect(pulledIds($resource, $w->company))->toBe([$id])
        ->and(pulledIds($resource, (string) Str::uuid7()))->toBe([])
        ->and($resource->query($w->company)->first()?->relationLoaded('lines'))->toBeTrue()
        ->and($resource->windowField())->toBe('document_date');
});

it('moves the request forward when only a line changes, and leaves a tombstone on delete', function (): void {
    $w = $this->w;
    $created = PurchKit::post($w->user, $w->company, 'purchase-requests', [
        'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'estimated_price' => '5']],
    ])->assertCreated()->json('data');
    $first = Sync::txidOf('purchase_requests', $created['id']);

    DB::table('purchase_request_lines')->where('document_id', $created['id'])->update(['description' => 'changed by line only']);
    $second = Sync::txidOf('purchase_requests', $created['id']);

    expect($second->value)->not->toBe($first->value)
        ->and(DB::table('purchase_requests')->where('id', $created['id'])->value('version'))->toBe(1);

    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-requests/{$created['id']}?version=1")->assertNoContent();

    expect(Sync::tombstone('purchase_requests', $created['id']))->not->toBeNull();
});

it('serves every purchasing document table through its adapter', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    $ids = ['purchase-orders' => $order['id'], 'purchase-receipts' => $receipt['id'], 'purchase-invoices' => $invoice['id']];

    foreach ($ids as $name => $id) {
        $resource = $this->resources[$name];
        Sync::awaitHorizonPast(Sync::txidOf($resource->table(), $id));

        expect(pulledIds($resource, $w->company))->toContain($id)
            ->and($resource->query($w->company)->whereKey($id)->first()?->relationLoaded('lines'))->toBeTrue();
    }
});

/**
 * Rows of the adapter that moved after $cursor and are below the horizon: an incremental pull.
 *
 * @return list<string>
 */
function pulledSince(SyncResource $resource, string $company, string $cursor): array
{
    return $resource->query($company)
        ->whereRaw("{$resource->positionColumn()} > ?::xid8", [$cursor])
        ->whereRaw("{$resource->positionColumn()} < ?::xid8", [Sync::horizon()->value])
        ->pluck($resource->table().'.id')->all();
}

/**
 * The pulled row as the client receives it, serialised by the adapter's resource.
 *
 * @return array<string, mixed>
 */
function pulledRow(SyncResource $resource, string $company, string $id): array
{
    $row = $resource->query($company)->whereKey($id)->firstOrFail();
    $class = $resource->resourceClass();

    return (new $class($row))->resolve(request());
}

/** @return list<array{item_id: mixed, quantity: mixed, returnable_quantity: mixed}> */
function lineFacts(array $row): array
{
    return array_map(static fn (array $l): array => ['item_id' => $l['item_id'], 'quantity' => $l['quantity'], 'returnable_quantity' => $l['returnable_quantity'] ?? null], $row['lines']);
}

it('serialises lines and returnable quantities by the explicit company, whatever the ambient context', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '2']]])->assertCreated();
    $rest = PurchKit::get($w->user, $w->company, "purchase-invoices/{$invoice['id']}")->assertOk()->json('data');
    $resource = $this->resources['purchase-invoices'];
    $context = app(CompanyContext::class);
    $context->clear();

    $empty = pulledRow($resource, $w->company, $invoice['id']);
    $other = $context->runAs((string) Str::uuid7(), fn (): array => pulledRow($resource, $w->company, $invoice['id']));

    expect(lineFacts($rest))->toBe([['item_id' => $w->item->id, 'quantity' => '5.000000', 'returnable_quantity' => '3.000000']])
        ->and(lineFacts($empty))->toBe(lineFacts($rest))
        ->and(lineFacts($other))->toBe(lineFacts($rest))
        ->and($empty['lines'])->toBe($rest['lines']);

    $requestId = PurchKit::post($w->user, $w->company, 'purchase-requests', ['lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'estimated_price' => '5']]])->json('data.id');
    $context->clear();
    $request = $context->runAs((string) Str::uuid7(), fn (): array => pulledRow($this->resources['purchase-requests'], $w->company, $requestId));

    expect($request['lines'])->toHaveCount(1)->and($request['lines'][0]['item_id'])->toBe($w->item->id);
});

it('moves the source invoice and receipt forward when a return or invoice changes what is returnable', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoices = $this->resources['purchase-invoices'];
    $receipts = $this->resources['purchase-receipts'];
    $cursor = Sync::txidOf('purchase_receipts', $receipt['id'])->value;

    // Billing the posted receipt leaves nothing returnable on it.
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    Sync::awaitHorizonPast(Sync::txidOf('purchase_receipts', $receipt['id']));
    app(CompanyContext::class)->clear();
    expect(pulledSince($receipts, $w->company, $cursor))->toBe([$receipt['id']])
        ->and(pulledRow($receipts, $w->company, $receipt['id'])['lines'][0]['returnable_quantity'])->toBe('0.000000')
        ->and(DB::table('purchase_receipts')->where('id', $receipt['id'])->value('version'))->toBe($receipt['version']);

    $line = $invoice['lines'][0]['id'];
    $step = function (Closure $change, string $returnable) use ($w, $invoices, $invoice): void {
        $cursor = Sync::txidOf('purchase_invoices', $invoice['id'])->value;
        $change();
        Sync::awaitHorizonPast(Sync::txidOf('purchase_invoices', $invoice['id']));
        app(CompanyContext::class)->clear();

        expect(pulledSince($invoices, $w->company, $cursor))->toBe([$invoice['id']])
            ->and(pulledRow($invoices, $w->company, $invoice['id'])['lines'][0]['returnable_quantity'])->toBe($returnable)
            ->and(DB::table('purchase_invoices')->where('id', $invoice['id'])->value('version'))->toBe($invoice['version']);
    };

    $return = null;
    $step(function () use ($w, $invoice, $line, &$return): void {
        $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $line, 'quantity' => '2']]])->assertCreated()->json('data');
    }, '3.000000');
    $step(function () use ($w, &$return, $line): void {
        $return = PurchKit::patch($w->user, $w->company, "purchase-returns/{$return['id']}", ['version' => $return['version'], 'lines' => [['invoice_line_id' => $line, 'quantity' => '1']]])->assertOk()->json('data');
    }, '4.000000');
    $step(function () use ($w, &$return): void {
        PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/cancel", ['version' => $return['version']])->assertOk()->assertJsonPath('data.status', 'cancelled');
    }, '5.000000');

    $draft = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $line, 'quantity' => '5']]])->assertCreated()->json('data');
    $step(function () use ($w, $draft): void {
        PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-returns/{$draft['id']}?version={$draft['version']}")->assertNoContent();
    }, '5.000000');
});

/**
 * A posted receipt R, its booked invoice I and a draft return T on I (its lines name I's line
 * and R's line); a draft invoice D on a second posted receipt R2.
 *
 * @return array<string, array<string, mixed>>
 */
function purchasingLockChain(object $w): array
{
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10'], [$w->item->id, '3', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '2']]])->assertCreated()->json('data');
    $second = PurchKit::receive($w, $order['id'], [$order['lines'][1]['id'] => '3']);
    $draft = PurchKit::post($w->user, $w->company, "purchase-receipts/{$second['id']}/invoice", ['document_date' => '2027-06-13', 'supplier_invoice_no' => 'SUP-'.Str::upper(Str::random(6))])->assertCreated()->json('data');

    return ['receipt' => $receipt, 'invoice' => $invoice, 'return' => $return, 'second' => $second, 'draft' => $draft];
}

/**
 * Names of the rows the SELECT ... FOR UPDATE statements of $fn lock, in first-lock order.
 *
 * @param  array<string, string>  $names  row id => name
 * @return list<string>
 */
function lockOrder(array $names, Closure $fn): array
{
    $locks = [];
    DB::listen(static function ($query) use (&$locks, $names): void {
        if (str_contains($query->sql, 'for update')) {
            foreach ($query->bindings as $binding) {
                if (is_string($binding) && isset($names[$binding])) {
                    $locks[] = $names[$binding];
                }
            }
        }
    });
    $fn();

    return array_values(array_unique($locks));
}

// purchasing_sync_touch_sources locks receipts and invoices from inside the invoice/return
// statement, so every path that may fire it locks receipt -> invoice -> return up front.
it('locks the sources before the document on every path that touches them', function (string $path): void {
    $w = $this->w;
    $c = purchasingLockChain($w);
    $names = [$c['receipt']['id'] => 'receipt', $c['invoice']['id'] => 'invoice', $c['return']['id'] => 'return', $c['second']['id'] => 'receipt', $c['draft']['id'] => 'invoice'];
    $as = PurchKit::as($w->user, $w->company);

    $order = lockOrder($names, fn () => match ($path) {
        'invoice cancel' => PurchKit::post($w->user, $w->company, "purchase-invoices/{$c['draft']['id']}/cancel")->assertOk(),
        'invoice delete' => $as->deleteJson("/api/v1/purchase-invoices/{$c['draft']['id']}?version={$c['draft']['version']}")->assertNoContent(),
        'return cancel' => PurchKit::post($w->user, $w->company, "purchase-returns/{$c['return']['id']}/cancel")->assertOk(),
        'return delete' => $as->deleteJson("/api/v1/purchase-returns/{$c['return']['id']}?version={$c['return']['version']}")->assertNoContent(),
        'return update' => PurchKit::patch($w->user, $w->company, "purchase-returns/{$c['return']['id']}", ['version' => $c['return']['version'], 'lines' => [['invoice_line_id' => $c['invoice']['lines'][0]['id'], 'quantity' => '1']]])->assertOk(),
    });

    expect($order)->toBe(str_starts_with($path, 'invoice') ? ['receipt', 'invoice'] : ['receipt', 'invoice', 'return']);
})->with(['invoice cancel', 'invoice delete', 'return cancel', 'return delete', 'return update']);

/**
 * Runs $fn while a second connection holds the row, under a short lock_timeout; returns the error.
 */
function whileHeld(string $table, string $id, Closure $fn): ?QueryException
{
    config(['database.connections.purchasing_lock_probe' => config('database.connections.'.config('database.default'))]);
    $other = DB::connection('purchasing_lock_probe');
    $other->beginTransaction();
    $other->select("select id from {$table} where id = ? for update", [$id]);
    DB::statement("SET lock_timeout = '300ms'");

    try {
        $fn();

        return null;
    } catch (Throwable $e) {
        $query = $e;
        while (! $query instanceof QueryException && $query->getPrevious() !== null) {
            $query = $query->getPrevious();
        }

        return $query instanceof QueryException ? $query : throw $e;
    } finally {
        DB::statement('SET lock_timeout = 0');
        $other->rollBack();
        DB::disconnect('purchasing_lock_probe');
    }
}

it('waits on a held source before it holds the document', function (string $path): void {
    $w = $this->w;
    $c = purchasingLockChain($w);
    [$table, $held, $run, $unchanged] = match ($path) {
        // Invoice update/book/reverse hold the receipt first.
        'invoice cancel' => ['purchase_receipts', $c['second']['id'],
            fn () => app(InvoiceService::class)->cancel(PurchaseInvoice::query()->findOrFail($c['draft']['id']), null, $w->user),
            fn (): bool => DB::table('purchase_invoices')->where('id', $c['draft']['id'])->value('status') === 'draft'],
        // A path holding the source invoice first (return approve/ship, invoice update).
        'return cancel' => ['purchase_invoices', $c['invoice']['id'],
            fn () => app(ReturnService::class)->cancel(PurchaseReturn::query()->findOrFail($c['return']['id']), null, $w->user),
            fn (): bool => DB::table('purchase_returns')->where('id', $c['return']['id'])->value('status') === 'draft'],
        // Invoice reverse holds the receipt before the invoice.
        'return update' => ['purchase_receipts', $c['receipt']['id'],
            fn () => app(ReturnService::class)->update(PurchaseReturn::query()->findOrFail($c['return']['id']), [], [['invoice_line_id' => $c['invoice']['lines'][0]['id'], 'quantity' => '1']], $c['return']['version']),
            fn (): bool => DB::table('purchase_returns')->where('id', $c['return']['id'])->value('version') === $c['return']['version']],
    };

    $failed = whileHeld($table, $held, fn () => PurchKit::in($w->company, $run));

    // The path's first lock is the held source: its explicit SELECT ... FOR UPDATE times out. The
    // document-first order would time out later, in the trigger's UPDATE of the source.
    expect($failed)->not->toBeNull()
        ->and($failed?->errorInfo[0] ?? null)->toBe('55P03')
        ->and($failed?->getSql())->toContain("from \"{$table}\"")->toContain('for update')
        ->and($failed?->getBindings())->toContain($held)
        ->and($unchanged())->toBeTrue();
})->with(['invoice cancel', 'return cancel', 'return update']);

/**
 * The source-change race: right after $path read the draft invoice's sources (R1) without a lock,
 * another transaction moves its line to R2 and commits. With $hold, a third connection then holds
 * R2 (as a path locking R2 before the invoice does).
 *
 * @return array{locks: list<string>, invoiceHeldAtR2: bool, failed: ?QueryException, chain: array<string, array<string, mixed>>}
 */
function sourceRace(object $w, string $path, bool $hold): array
{
    $c = purchasingLockChain($w);
    $draft = $c['draft']['id'];
    $r1 = $c['second']['id'];
    $r2 = $c['receipt']['id'];
    $r2Line = $c['receipt']['lines'][0]['id'];
    $names = [$r1 => 'R1', $r2 => 'R2', $draft => 'invoice'];
    $default = config('database.default');
    config(['database.connections.purchasing_race' => config("database.connections.{$default}"), 'database.connections.purchasing_peek' => config("database.connections.{$default}")]);
    $race = DB::connection('purchasing_race');
    $peek = DB::connection('purchasing_peek');
    $state = ['moved' => false, 'locks' => [], 'invoiceHeldAtR2' => false];

    DB::connection()->beforeExecuting(static function (string $sql, array $bindings) use (&$state, $names, $draft, $r2, $r2Line, $race, $peek, $hold): void {
        if (! str_contains($sql, 'for update')) {
            return;
        }

        $name = null;
        foreach ($bindings as $binding) {
            $name ??= is_string($binding) ? ($names[$binding] ?? null) : null;
        }

        if ($name === null) {
            return;
        }

        if (! $state['moved']) {
            // B: the draft's line now bills R2 (committed). C: holds R2.
            $state['moved'] = true;
            $race->table('purchase_invoice_lines')->where('document_id', $draft)->update(['receipt_line_id' => $r2Line]);
            if ($hold) {
                $race->beginTransaction();
                $race->select('select id from purchase_receipts where id = ? for update', [$r2]);
            }
        }

        if ($name === 'R2') {
            // Does this transaction hold the invoice while it asks for R2?
            try {
                $peek->select('select id from purchase_invoices where id = ? for update nowait', [$draft]);
            } catch (QueryException) {
                $state['invoiceHeldAtR2'] = true;
            }
        }

        // Consecutive locks of the same row (a transition re-reading the invoice) count once.
        if (end($state['locks']) !== $name) {
            $state['locks'][] = $name;
        }
    });

    $run = fn () => PurchKit::in($w->company, fn () => match ($path) {
        'cancel' => app(InvoiceService::class)->cancel(PurchaseInvoice::query()->findOrFail($draft), null, $w->user),
        'delete' => app(InvoiceService::class)->delete(PurchaseInvoice::query()->findOrFail($draft), null),
    });
    $failed = null;
    DB::statement("SET lock_timeout = '300ms'");

    try {
        $run();
    } catch (Throwable $e) {
        $query = $e;
        while (! $query instanceof QueryException && $query->getPrevious() !== null) {
            $query = $query->getPrevious();
        }
        $failed = $query instanceof QueryException ? $query : throw $e;
    } finally {
        DB::statement('SET lock_timeout = 0');
        if ($race->transactionLevel() > 0) {
            $race->rollBack();
        }
        DB::disconnect('purchasing_race');
        DB::disconnect('purchasing_peek');
    }

    return ['locks' => $state['locks'], 'invoiceHeldAtR2' => $state['invoiceHeldAtR2'], 'failed' => $failed, 'chain' => $c];
}

it('retries when the invoice sources change under it, and locks the new source before the invoice', function (string $path): void {
    $race = sourceRace($this->w, $path, false);
    $draft = $race['chain']['draft']['id'];

    // First attempt: R1 then the invoice, which now bills R2: rolled back. Second attempt: R2 first.
    expect($race['failed'])->toBeNull()
        ->and($race['locks'])->toBe(['R1', 'invoice', 'R2', 'invoice'])
        ->and($race['invoiceHeldAtR2'])->toBeFalse()
        ->and(DB::table('purchase_invoices')->where('id', $draft)->value('status'))->toBe($path === 'cancel' ? 'cancelled' : null);
})->with(['cancel', 'delete']);

it('never waits on a moved source while it holds the invoice', function (string $path): void {
    $race = sourceRace($this->w, $path, true);
    $draft = $race['chain']['draft']['id'];

    // R2 is held: the retry times out on its explicit lock of R2, holding nothing of the invoice.
    // Locking R2 under the invoice (or touching it from the trigger) is the deadlock the review found.
    expect($race['invoiceHeldAtR2'])->toBeFalse()
        ->and($race['failed'])->not->toBeNull()
        ->and($race['failed']?->errorInfo[0] ?? null)->toBe('55P03')
        ->and($race['failed']?->getSql())->toContain('from "purchase_receipts"')->toContain('for update')
        ->and($race['failed']?->getBindings())->toContain($race['chain']['receipt']['id'])
        ->and(DB::table('purchase_invoices')->where('id', $draft)->value('status'))->toBe('draft');
})->with(['cancel', 'delete']);

it('gives up with VERSION_CONFLICT when the sources keep changing', function (): void {
    $w = $this->w;
    $c = purchasingLockChain($w);
    $draft = $c['draft']['id'];
    $lines = [$c['second']['lines'][0]['id'], $c['receipt']['lines'][0]['id']];
    config(['database.connections.purchasing_race' => config('database.connections.'.config('database.default'))]);
    $race = DB::connection('purchasing_race');
    $flips = 0;

    // Every attempt: after the unlocked read, the line moves to the other receipt.
    DB::connection()->beforeExecuting(static function (string $sql, array $bindings) use (&$flips, $race, $draft, $lines): void {
        if (str_contains($sql, 'for update') && str_contains($sql, 'purchase_receipts')) {
            $race->table('purchase_invoice_lines')->where('document_id', $draft)->update(['receipt_line_id' => $lines[++$flips % 2]]);
        }
    });

    $failed = null;
    try {
        PurchKit::in($w->company, fn () => app(InvoiceService::class)->cancel(PurchaseInvoice::query()->findOrFail($draft), null, $w->user));
    } catch (VersionConflictException $e) {
        $failed = $e;
    } finally {
        DB::disconnect('purchasing_race');
    }

    expect($failed)->not->toBeNull()->and($flips)->toBe(3)
        ->and(DB::table('purchase_invoices')->where('id', $draft)->value('status'))->toBe('draft');
});

it('retries a return created while the source invoice sources change, instead of failing', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10'], [$w->item->id, '3', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $other = PurchKit::receive($w, $order['id'], [$order['lines'][1]['id'] => '3']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    config(['database.connections.purchasing_race' => config('database.connections.'.config('database.default'))]);
    $race = DB::connection('purchasing_race');
    $receiptLocks = 0;

    // Once, right after the unlocked read of the invoice sources, a concurrent change moves the
    // invoice line to another receipt (forced past the guards: the race lockWithSources rechecks).
    DB::connection()->beforeExecuting(static function (string $sql) use (&$receiptLocks, $race, $invoice, $other): void {
        if (str_contains($sql, 'for update') && str_contains($sql, '"purchase_receipts"') && ++$receiptLocks === 1) {
            $race->statement('SET session_replication_role = replica');
            $race->table('purchase_invoice_lines')->where('document_id', $invoice['id'])->update(['receipt_line_id' => $other['lines'][0]['id']]);
            $race->statement('SET session_replication_role = DEFAULT');
        }
    });

    try {
        $response = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']]]);
    } finally {
        DB::disconnect('purchasing_race');
    }

    // First attempt rolled back (SourcesChanged), the second locks the new receipt first and creates.
    $response->assertCreated();
    expect($receiptLocks)->toBe(2)
        ->and(DB::table('purchase_returns')->where('invoice_id', $invoice['id'])->count())->toBe(1);
});

it('leaves a pending invoice pending when its approval keeps losing the source race', function (): void {
    $w = $this->w;
    $c = purchasingLockChain($w);
    $draft = $c['draft']['id'];
    PurchKit::setting($w->company, 'purchasing.invoice_approval_over', '10');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage']);
    PurchKit::post($approver, $w->company, 'approval-flows', [
        'name' => 'Supplier invoices', 'document_type' => 'purchase_invoice',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();
    $pending = PurchKit::post($w->user, $w->company, "purchase-invoices/{$draft}/book")->assertOk()->assertJsonPath('data.status', 'pending_approval')->json('data');
    $lines = [$c['second']['lines'][0]['id'], $c['receipt']['lines'][0]['id']];
    config(['database.connections.purchasing_race' => config('database.connections.'.config('database.default'))]);
    $race = DB::connection('purchasing_race');
    $flips = 0;

    DB::connection()->beforeExecuting(static function (string $sql) use (&$flips, $race, $draft, $lines): void {
        if (str_contains($sql, 'for update') && str_contains($sql, '"purchase_receipts"')) {
            $race->table('purchase_invoice_lines')->where('document_id', $draft)->update(['receipt_line_id' => $lines[++$flips % 2]]);
        }
    });

    $failed = null;
    try {
        PurchKit::in($w->company, fn () => app(InvoiceService::class)->approvalCompleted($draft, $pending['approval_request_id']));
    } catch (VersionConflictException $e) {
        $failed = $e;
    } finally {
        DB::disconnect('purchasing_race');
    }

    // A transient race is not a booking failure: no fallback to draft, no failure notice; the
    // exception reaches the approval so the decision can be retried.
    $row = DB::table('purchase_invoices')->where('id', $draft)->first();
    expect($failed)->not->toBeNull()->and($flips)->toBe(3)
        ->and($row->status)->toBe('pending_approval')
        ->and($row->approval_comment)->toBeNull()
        ->and(DB::table('notifications')->where('type', 'purchasing.invoice_approval_failed')->exists())->toBeFalse();
});
