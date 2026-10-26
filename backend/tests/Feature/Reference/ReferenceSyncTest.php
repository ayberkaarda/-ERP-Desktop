<?php

declare(strict_types=1);

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Core\Sync\Xid8;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Sync\CurrencySyncResource;
use App\Modules\Reference\Sync\ExchangeRateSyncResource;
use App\Modules\Reference\Sync\LocationSyncResource;
use App\Modules\Reference\Sync\PaymentTermSyncResource;
use App\Modules\Reference\Sync\TaxCodeSyncResource;
use App\Modules\Reference\Sync\WarehouseSyncResource;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->company = Actors::company();
    Actors::activate($this->company);
});

/** @return list<string> */
function referenceSyncIds(SyncResource $resource, string $company, Xid8 $horizon, ?Xid8 $after = null): array
{
    $query = $resource->query($company)
        ->whereRaw("{$resource->positionColumn()} < ?::xid8", [$horizon->value]);
    if ($after !== null) {
        $query->whereRaw("{$resource->positionColumn()} > ?::xid8", [$after->value]);
    }

    return $query->get()->pluck('id')->all();
}

it('registers exactly the manifest Reference resources with their read contracts', function (): void {
    $manifest = json_decode(file_get_contents(base_path('../contracts/offline-manifest.json')), true, flags: JSON_THROW_ON_ERROR);
    $expected = [];
    foreach ($manifest['resources'] as $entry) {
        if ($entry['module'] !== 'Reference') {
            continue;
        }
        $expected[$entry['resource']] = $entry;
        foreach ($entry['children'] ?? [] as $child) {
            $expected[$child['resource']] = array_replace($entry, $child);
        }
    }
    $resources = collect(iterator_to_array(app()->tagged(SyncResource::TAG)))
        ->filter(fn (SyncResource $resource): bool => str_starts_with($resource::class, 'App\\Modules\\Reference\\Sync\\'))
        ->keyBy(fn (SyncResource $resource): string => $resource->name());

    expect($resources->keys()->sort()->values()->all())->toBe(collect(array_keys($expected))->sort()->values()->all());
    foreach ($resources as $name => $resource) {
        expect($resource->scope()->value)->toBe($expected[$name]['scope'])
            ->and($resource->resourceClass())->toBe($expected[$name]['api_resource'])
            ->and($resource->embeds())->toBe($expected[$name]['embeds'] ?? [])
            ->and($resource->windowField())->toBe($expected[$name]['window_field'] ?? null)
            ->and($resource->parentKey())->toBe($name === 'warehouses.locations' ? 'warehouse_id' : null);
    }
});

it('delivers global TCMB rates to both companies and manual rates only to their owner', function (): void {
    $global = ExchangeRate::factory()->create(['rate_date' => now()->toDateString()]);
    $manual = ExchangeRate::factory()->create(['source' => 'manual', 'rate_date' => now()->toDateString()]);
    $other = (string) Str::uuid7();
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('exchange_rates', $manual->id));
    $resource = new ExchangeRateSyncResource;
    Actors::activate($other);

    expect(referenceSyncIds($resource, $this->company, $horizon))->toContain($global->id, $manual->id)
        ->and(referenceSyncIds($resource, $other, $horizon))->toContain($global->id)->not->toContain($manual->id)
        ->and($resource->scope())->toBe(SyncScope::CompanyOrGlobal)
        ->and($resource->windowField())->toBe('rate_date');
});

it('keeps global taxes visible and company taxes isolated independently of active context', function (): void {
    $global = TaxCode::factory()->create(['code' => 'SYNC-GLOBAL']);
    $custom = TaxCode::factory()->make(['code' => 'SYNC-CUSTOM']);
    $custom->setAttribute('company_id', $this->company)->save();
    $other = (string) Str::uuid7();
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('tax_codes', $custom->id));
    Actors::activate($other);
    $resource = new TaxCodeSyncResource;

    expect(referenceSyncIds($resource, $this->company, $horizon))->toContain($global->id, $custom->id)
        ->and(referenceSyncIds($resource, $other, $horizon))->toContain($global->id)->not->toContain($custom->id);
});

it('republishes currency activation changes only in the owning company stream', function (): void {
    $currency = Currency::factory()->create(['code' => 'XTS']);
    $activation = CompanyCurrency::factory()->create(['currency_code' => 'XTS']);
    $before = Sync::txidOf('company_currencies', $activation->id);
    $globalPosition = Sync::txidOf('currencies', $currency->id);
    Sync::awaitHorizonPast($before);
    $activation->setAttribute('is_active', false)->setAttribute('version', 2)->save();
    $changed = Sync::txidOf('company_currencies', $activation->id);
    $horizon = Sync::awaitHorizonPast($changed);
    $other = (string) Str::uuid7();
    Actors::activate($other);
    $resource = new CurrencySyncResource;
    $row = $resource->query($this->company)->where('currencies.id', $currency->id)->firstOrFail();
    $data = (new ReferenceResource($row))->resolve();

    expect($changed->greaterThan($before))->toBeTrue()
        ->and(referenceSyncIds($resource, $this->company, $horizon, $before))->toContain($currency->id)
        ->and(referenceSyncIds($resource, $other, $horizon, $before))->not->toContain($currency->id)
        ->and(Sync::txidOf('currencies', $currency->id)->value)->toBe($globalPosition->value)
        ->and($data['company_is_active'])->toBeFalse()
        ->and($data['company_version'])->toBe(2);

    Actors::activate($this->company);
    $activation->delete();
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('company_currencies', $activation->id));
    expect(referenceSyncIds($resource, $this->company, $horizon, $changed))->toContain($currency->id);
    $deleted = (new ReferenceResource($resource->query($this->company)->where('currencies.id', $currency->id)->firstOrFail()))->resolve();
    expect($deleted['company_is_active'])->toBeFalse()->and($deleted['company_version'])->toBe(1);
});

it('emits a soft delete tombstone and excludes the deleted live row', function (): void {
    $record = PaymentTerm::factory()->create();
    $record->delete();
    $tombstone = Sync::tombstone('payment_terms', $record->id);
    expect($tombstone)->not->toBeNull();
    $horizon = Sync::awaitHorizonPast(Xid8::of($tombstone->sync_txid));

    expect($tombstone->company_id)->toBe($this->company)
        ->and($tombstone->reason)->toBe('soft_deleted')
        ->and(referenceSyncIds(new PaymentTermSyncResource, $this->company, $horizon))->not->toContain($record->id);
    $record->restore();
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('payment_terms', $record->id));
    expect(Sync::tombstone('payment_terms', $record->id))->toBeNull()
        ->and(referenceSyncIds(new PaymentTermSyncResource, $this->company, $horizon))->toContain($record->id);
});

it('touches both the location and warehouse and preserves the child tombstone parent', function (): void {
    $warehouse = Warehouse::factory()->create();
    $location = Location::factory()->create(['warehouse_id' => $warehouse->id]);
    $before = Sync::txidOf('warehouses', $warehouse->id);
    Sync::awaitHorizonPast($before);
    $location->setAttribute('name', 'Updated bin')->save();
    $changed = Sync::txidOf('locations', $location->id);
    $horizon = Sync::awaitHorizonPast($changed);

    expect($changed->greaterThan($before))->toBeTrue()
        ->and(Sync::txidOf('warehouses', $warehouse->id)->value)->toBe($changed->value)
        ->and(referenceSyncIds(new LocationSyncResource, $this->company, $horizon, $before))->toContain($location->id)
        ->and(referenceSyncIds(new WarehouseSyncResource, $this->company, $horizon, $before))->toContain($warehouse->id);
    $location->delete();
    $tombstone = Sync::tombstone('locations', $location->id);
    expect($tombstone?->parent_id)->toBe($warehouse->id)
        ->and($tombstone?->company_id)->toBe($this->company);
});

it('returns the same currency JSON as REST index without sync metadata', function (): void {
    $currency = Currency::factory()->create(['code' => 'XTS']);
    CompanyCurrency::factory()->create(['currency_code' => 'XTS', 'is_active' => true]);
    $resource = new CurrencySyncResource;
    Sync::awaitHorizonPast(Sync::txidOf('company_currencies', CompanyCurrency::query()->where('currency_code', 'XTS')->firstOrFail()->id));
    $user = Actors::user(['currencies.view']);
    Sanctum::actingAs($user);
    $rows = $this->getJson('/api/v1/currencies?per_page=100', ['X-Company-Id' => $this->company])->assertOk()->json('data');
    $rest = collect($rows)->firstWhere('id', $currency->id);
    $synced = (new ReferenceResource($resource->query($this->company)->where('currencies.id', $currency->id)->firstOrFail()))->resolve();

    expect($synced)->toEqual($rest)->not->toHaveKey('sync_txid');
});

it('matches REST index shape for each remaining Reference stream', function (string $adapter, string $model, string $path, string $permission): void {
    $attributes = $model === ExchangeRate::class ? ['rate_date' => now()->toDateString()] : [];
    if ($model === Location::class) {
        $warehouse = Warehouse::factory()->create();
        $attributes['warehouse_id'] = $warehouse->id;
        $path = '/api/v1/warehouses/'.$warehouse->id.'/locations';
    }
    $record = $model::factory()->create($attributes);
    $resource = app($adapter);
    $horizon = Sync::awaitHorizonPast(Sync::txidOf($resource->table(), $record->id));
    Sanctum::actingAs(Actors::user([$permission]));
    $rows = $this->getJson($path.'?per_page=100', ['X-Company-Id' => $this->company])->assertOk()->json('data');
    $rest = collect($rows)->firstWhere('id', $record->id);
    $row = $resource->query($this->company)
        ->where($resource->table().'.id', $record->id)
        ->whereRaw("{$resource->positionColumn()} < ?::xid8", [$horizon->value])->firstOrFail();
    $resourceClass = $resource->resourceClass();

    expect((new $resourceClass($row))->resolve())->toEqual($rest)->not->toHaveKey('sync_txid');
})->with([
    [ExchangeRateSyncResource::class, ExchangeRate::class, '/api/v1/exchange-rates', 'exchange_rates.view'],
    [TaxCodeSyncResource::class, TaxCode::class, '/api/v1/tax-codes', 'tax_codes.view'],
    [PaymentTermSyncResource::class, PaymentTerm::class, '/api/v1/payment-terms', 'payment_terms.view'],
    [WarehouseSyncResource::class, Warehouse::class, '/api/v1/warehouses', 'warehouses.view'],
    [LocationSyncResource::class, Location::class, '', 'warehouses.view'],
    [\App\Modules\Reference\Sync\CostCenterSyncResource::class, \App\Modules\Reference\Models\CostCenter::class, '/api/v1/cost-centers', 'cost_centers.view'],
    [\App\Modules\Reference\Sync\ProjectSyncResource::class, \App\Modules\Reference\Models\Project::class, '/api/v1/projects', 'projects.view'],
]);
