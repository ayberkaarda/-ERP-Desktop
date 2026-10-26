<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Contracts\SyncResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\SyncDatabase;
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
