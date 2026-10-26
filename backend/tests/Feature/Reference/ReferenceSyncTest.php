<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Core\Sync\Xid8;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\Project;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Sync\CostCenterSyncResource;
use App\Modules\Reference\Sync\CurrencySyncResource;
use App\Modules\Reference\Sync\ExchangeRateSyncResource;
use App\Modules\Reference\Sync\LocationSyncResource;
use App\Modules\Reference\Sync\PaymentTermSyncResource;
use App\Modules\Reference\Sync\ProjectSyncResource;
use App\Modules\Reference\Sync\TaxCodeSyncResource;
use App\Modules\Reference\Sync\WarehouseSyncResource;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
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

/**
 * Pull events of one resource for a company as docs/SYNC-PROTOCOL.md defines them: live rows of
 * query() in the position window, plus tombstones of the resource table in the same window that
 * match the resource scope and have no live row. This branch has no Core pull service yet, so
 * the read follows the protocol over the adapter contract (query, positionColumn, scope, table).
 *
 * @return array{rows: list<string>, tombstones: list<string>}
 */
function referencePull(SyncResource $resource, string $company, Xid8 $horizon, ?Xid8 $after = null): array
{
    $live = $resource->query($company)->pluck($resource->table().'.id')->all();
    $tombstones = DB::table('sync_tombstones')
        ->where('resource_table', $resource->table())
        ->whereRaw('sync_txid < ?::xid8', [$horizon->value])
        ->when($after !== null, fn (QueryBuilder $query): QueryBuilder => $query->whereRaw('sync_txid > ?::xid8', [$after?->value]))
        ->where(function (QueryBuilder $query) use ($resource, $company): void {
            match ($resource->scope()) {
                SyncScope::Company => $query->where('company_id', $company),
                SyncScope::CompanyOrGlobal => $query->whereNull('company_id')->orWhere('company_id', $company),
                SyncScope::GlobalWithCompanyActivation => $query->whereNull('company_id'),
            };
        })
        ->whereNotIn('row_id', $live)
        ->pluck('row_id')->all();

    /** @var list<string> $tombstones */
    return ['rows' => referenceSyncIds($resource, $company, $horizon, $after), 'tombstones' => $tombstones];
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
    [CostCenterSyncResource::class, CostCenter::class, '/api/v1/cost-centers', 'cost_centers.view'],
    [ProjectSyncResource::class, Project::class, '/api/v1/projects', 'projects.view'],
]);

it('keeps each company\'s live rows and tombstones out of the other company\'s pull', function (string $adapter, Closure $create): void {
    $first = $this->company;
    $second = Actors::company();
    $made = [];
    foreach ([$first, $second] as $company) {
        Actors::activate($company);
        $live = $create(1);
        $deleted = $create(2);
        $deleted->delete();
        $made[$company] = ['live' => $live->getKey(), 'deleted' => $deleted->getKey()];
        expect(Sync::tombstone($deleted->getTable(), $deleted->getKey())?->company_id)->toBe($company);
    }
    $resource = app($adapter);
    $horizon = Sync::awaitHorizonPast(Xid8::of(Sync::tombstone($resource->table(), $made[$second]['deleted'])->sync_txid));
    // A third, unrelated active context: the reader takes the company only from its argument.
    Actors::activate((string) Str::uuid7());

    foreach ([[$first, $second], [$second, $first]] as [$own, $foreign]) {
        $pull = referencePull($resource, $own, $horizon);
        expect($pull['rows'])->toContain($made[$own]['live'])
            ->not->toContain($made[$own]['deleted'])->not->toContain($made[$foreign]['live'])->not->toContain($made[$foreign]['deleted'])
            ->and($pull['tombstones'])->toContain($made[$own]['deleted'])
            ->not->toContain($made[$foreign]['deleted'])->not->toContain($made[$foreign]['live'])->not->toContain($made[$own]['live']);
    }
})->with([
    'exchange-rates' => [ExchangeRateSyncResource::class, fn (int $n): Model => ExchangeRate::factory()->create(['source' => 'manual', 'rate_date' => now()->subDays($n)->toDateString()])],
    'tax-codes' => [TaxCodeSyncResource::class, function (): Model {
        $tax = TaxCode::factory()->make();
        $tax->setAttribute('company_id', app(CompanyContext::class)->id())->save();

        return $tax;
    }],
    'payment-terms' => [PaymentTermSyncResource::class, fn (): Model => PaymentTerm::factory()->create()],
    'warehouses' => [WarehouseSyncResource::class, fn (): Model => Warehouse::factory()->create()],
    'warehouses.locations' => [LocationSyncResource::class, fn (): Model => Location::factory()->create(['warehouse_id' => Warehouse::factory()->create()->id])],
    'cost-centers' => [CostCenterSyncResource::class, fn (): Model => CostCenter::factory()->create()],
    'projects' => [ProjectSyncResource::class, fn (): Model => Project::factory()->create()],
]);

it('keeps currency activation changes in their own company stream and global tombstones in both', function (): void {
    $first = $this->company;
    $second = Actors::company();
    $ownA = Currency::factory()->create(['code' => 'XTA', 'name' => 'Test A']);
    $ownB = Currency::factory()->create(['code' => 'XTB', 'name' => 'Test B']);
    $retired = Currency::factory()->create(['code' => 'XTC', 'name' => 'Test C']);
    Actors::activate($first);
    $activationA = CompanyCurrency::factory()->create(['currency_code' => 'XTA']);
    Actors::activate($second);
    $activationB = CompanyCurrency::factory()->create(['currency_code' => 'XTB']);
    $baseline = Sync::txidOf('company_currencies', $activationB->id);
    Sync::awaitHorizonPast($baseline);

    Actors::activate($first);
    $activationA->setAttribute('is_active', false)->save();
    Actors::activate($second);
    $activationB->delete();
    $retired->delete();
    $horizon = Sync::awaitHorizonPast(Xid8::of(Sync::tombstone('currencies', $retired->id)->sync_txid));
    Actors::activate((string) Str::uuid7());
    $resource = new CurrencySyncResource;
    $pullA = referencePull($resource, $first, $horizon, $baseline);
    $pullB = referencePull($resource, $second, $horizon, $baseline);

    expect($pullA['rows'])->toContain($ownA->id)->not->toContain($ownB->id)->not->toContain($retired->id)
        ->and($pullB['rows'])->toContain($ownB->id)->not->toContain($ownA->id)->not->toContain($retired->id)
        ->and($pullA['tombstones'])->toBe([$retired->id])
        ->and($pullB['tombstones'])->toBe([$retired->id]);
});

it('refuses physical deletes and identity moves of currency activations', function (): void {
    $currency = Currency::factory()->create(['code' => 'XTS', 'name' => 'Test S']);
    Currency::factory()->create(['code' => 'XTT', 'name' => 'Test T']);
    $activation = CompanyCurrency::factory()->create(['currency_code' => 'XTS']);
    $rows = fn () => DB::table('company_currencies')->where('id', $activation->id);

    expect(fn () => $activation->forceDelete())->toThrow(QueryException::class, 'soft deleted only')
        ->and(fn () => $rows()->delete())->toThrow(QueryException::class, 'soft deleted only')
        ->and(fn () => DB::statement('TRUNCATE company_currencies'))->toThrow(QueryException::class, 'soft deleted only')
        ->and(fn () => $rows()->update(['currency_code' => 'XTT']))->toThrow(QueryException::class, 'keep their company and currency')
        ->and(fn () => $rows()->update(['company_id' => Actors::company()]))->toThrow(QueryException::class, 'keep their company and currency')
        ->and($rows()->value('currency_code'))->toBe('XTS')
        ->and($rows()->value('company_id'))->toBe($this->company);

    // The supported path, soft delete, still moves the currency forward in the company stream.
    $before = Sync::txidOf('company_currencies', $activation->id);
    Sync::awaitHorizonPast($before);
    Actors::activate($this->company);
    // A fresh model: the refused forceDelete() leaves $activation flagged as force deleting.
    CompanyCurrency::query()->findOrFail($activation->id)->delete();
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('company_currencies', $activation->id));
    expect(referenceSyncIds(new CurrencySyncResource, $this->company, $horizon, $before))->toContain($currency->id);
});
