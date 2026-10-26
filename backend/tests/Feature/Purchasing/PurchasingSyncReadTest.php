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
