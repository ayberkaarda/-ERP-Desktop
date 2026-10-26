<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Models\Branch;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\DimensionLookup;
use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Reference\Contracts\WarehouseLookup;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\Project;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\ExternalReferences;
use App\Modules\Reference\Services\NullLookup;
use App\Modules\Settings\Contracts\SettingsReader;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    Actors::activate($this->company);
});

it('requires authentication and module permission on every list', function (string $resource): void {
    $this->getJson('/api/v1/'.$resource, ['X-Company-Id' => $this->company])->assertUnauthorized();
    Sanctum::actingAs(Actors::user());
    $this->getJson('/api/v1/'.$resource, ['X-Company-Id' => $this->company])->assertForbidden();
})->with(['currencies', 'exchange-rates', 'tax-codes', 'payment-terms', 'warehouses', 'cost-centers', 'projects']);

it('creates, lists, updates with optimistic locking and soft deletes company records', function (string $resource, string $permission, array $payload, string $table): void {
    Sanctum::actingAs(Actors::user([$permission.'.view', $permission.'.create', $permission.'.update', $permission.'.delete']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $response = $this->postJson('/api/v1/'.$resource, $payload, $headers)->assertCreated()->assertJsonPath('data.version', 1);
    $id = $response->json('data.id');
    $this->getJson('/api/v1/'.$resource.'?q=TEST&per_page=1', $headers)->assertOk()->assertJsonPath('meta.pagination.total', 1);
    $this->getJson('/api/v1/'.$resource.'/'.$id, $headers)->assertOk()->assertJsonPath('data.id', $id);
    $this->patchJson('/api/v1/'.$resource.'/'.$id, ['name' => 'Changed', 'version' => 1], $headers)->assertOk()->assertJsonPath('data.version', 2);
    $this->patchJson('/api/v1/'.$resource.'/'.$id, ['name' => 'Stale', 'version' => 1], $headers)->assertConflict()->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    $this->deleteJson('/api/v1/'.$resource.'/'.$id, ['version' => 2], $headers)->assertNoContent();
    $this->assertSoftDeleted($table, ['id' => $id]);
})->with([
    ['payment-terms', 'payment_terms', ['code' => 'TEST', 'name' => 'Net 30', 'due_days' => 30], 'payment_terms'],
    ['warehouses', 'warehouses', ['code' => 'TEST', 'name' => 'Main'], 'warehouses'],
    ['cost-centers', 'cost_centers', ['code' => 'TEST', 'name' => 'Office'], 'cost_centers'],
    ['projects', 'projects', ['code' => 'TEST', 'name' => 'Launch'], 'projects'],
    ['tax-codes', 'tax_codes', ['code' => 'TEST', 'name' => 'Custom', 'type' => 'vat', 'rate' => '20.0000', 'effective_from' => '2023-07-10'], 'tax_codes'],
]);

it('rejects writes without permission even when the actor can view', function (string $resource, string $permission, string $model, array $payload): void {
    $record = $model::factory()->create();
    Sanctum::actingAs(Actors::user([$permission.'.view']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $this->getJson('/api/v1/'.$resource.'/'.$record->id, $headers)->assertOk();
    $this->postJson('/api/v1/'.$resource, $payload, $headers)->assertForbidden();
    $this->patchJson('/api/v1/'.$resource.'/'.$record->id, ['name' => 'Denied', 'version' => 1], $headers)->assertForbidden();
    $this->deleteJson('/api/v1/'.$resource.'/'.$record->id, ['version' => 1], $headers)->assertForbidden();
})->with([
    ['payment-terms', 'payment_terms', PaymentTerm::class, ['code' => 'NEW', 'name' => 'Term', 'due_days' => 1]],
    ['warehouses', 'warehouses', Warehouse::class, ['code' => 'NEW', 'name' => 'Depot']],
    ['cost-centers', 'cost_centers', CostCenter::class, ['code' => 'NEW', 'name' => 'Cost']],
    ['projects', 'projects', Project::class, ['code' => 'NEW', 'name' => 'Project']],
]);

it('hides another company records from lists, detail, updates, deletes and lookups', function (string $resource, string $permission, string $model): void {
    $user = Actors::user([$permission.'.view', $permission.'.update', $permission.'.delete']);
    $other = Actors::companyFor($user, [$permission.'.view', $permission.'.update', $permission.'.delete']);
    $record = app(CompanyContext::class)->runAs($other, fn () => $model::factory()->create());
    Sanctum::actingAs($user);
    $headers = ['X-Company-Id' => $this->company];
    $this->getJson('/api/v1/'.$resource, $headers)->assertOk()->assertJsonPath('meta.pagination.total', 0);
    $this->getJson('/api/v1/'.$resource.'/'.$record->id, $headers)->assertNotFound();
    $this->patchJson('/api/v1/'.$resource.'/'.$record->id, ['name' => 'Stolen', 'version' => 1], $headers)->assertNotFound();
    $this->deleteJson('/api/v1/'.$resource.'/'.$record->id, ['version' => 1], $headers)->assertNotFound();
})->with([
    ['payment-terms', 'payment_terms', PaymentTerm::class],
    ['warehouses', 'warehouses', Warehouse::class],
    ['cost-centers', 'cost_centers', CostCenter::class],
    ['projects', 'projects', Project::class],
]);

it('requires idempotency and replays a creation only once', function (): void {
    Sanctum::actingAs(Actors::user(['payment_terms.create']));
    $payload = ['code' => 'NET30', 'name' => 'Net 30', 'due_days' => 30];
    $headers = ['X-Company-Id' => $this->company];
    $this->postJson('/api/v1/payment-terms', $payload, $headers)->assertStatus(400);
    $headers['Idempotency-Key'] = (string) Str::uuid();
    $first = $this->postJson('/api/v1/payment-terms', $payload, $headers)->assertCreated()->json('data.id');
    $this->postJson('/api/v1/payment-terms', $payload, $headers)->assertCreated()->assertJsonPath('data.id', $first);
    expect(PaymentTerm::query()->count())->toBe(1);
    $this->postJson('/api/v1/payment-terms', [...$payload, 'due_days' => 31], $headers)->assertUnprocessable();
});

it('isolates company activation without changing a global currency', function (): void {
    $this->seed(ReferenceSeeder::class);
    $currency = Currency::query()->where('code', 'USD')->firstOrFail();
    $user = Actors::user(['currencies.view', 'currencies.update']);
    $other = Actors::companyFor($user, ['currencies.view', 'currencies.update']);
    Sanctum::actingAs($user);
    $this->patchJson('/api/v1/currencies/'.$currency->id, ['is_active' => true, 'version' => 1], ['X-Company-Id' => $this->company])->assertOk();
    $this->getJson('/api/v1/currencies/'.$currency->id, ['X-Company-Id' => $this->company])->assertOk()->assertJsonPath('data.company_is_active', true);
    $this->getJson('/api/v1/currencies/'.$currency->id, ['X-Company-Id' => $other])->assertOk()->assertJsonPath('data.company_is_active', false);
    expect($currency->fresh()->getAttribute('is_active'))->toBeTrue();
    Actors::activate($this->company);
    expect(CompanyCurrency::query()->count())->toBe(1);
});

it('keeps seeded taxes immutable and records verified source metadata', function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->seed(ReferenceSeeder::class);
    expect(TaxCode::query()->count())->toBe(6);
    $statuses = TaxCode::query()->orderBy('code')->get()->mapWithKeys(fn (TaxCode $tax): array => [$tax->getAttribute('code') => $tax->getAttribute('meta')['status']])->all();
    expect($statuses)->toBe(['301' => 'verified', '601' => 'verified', 'VAT0' => 'needs_review', 'VAT1' => 'verified', 'VAT10' => 'verified', 'VAT20' => 'verified']);
    foreach (TaxCode::query()->get() as $tax) {
        expect($tax->getAttribute('meta'))->toHaveKeys(['source_url', 'retrieved_at', 'effective_period_verified', 'note'])
            ->and($tax->getAttribute('meta')['retrieved_at'])->toBe('2026-10-21');
    }
    $withholding = TaxCode::query()->where('code', '601')->firstOrFail();
    expect([$withholding->getAttribute('numerator'), $withholding->getAttribute('denominator')])->toBe([4, 10])
        ->and(TaxCode::query()->where('code', 'VAT20')->value('rate'))->toBe('20.0000');
    Sanctum::actingAs(Actors::user(['tax_codes.view', 'tax_codes.update', 'tax_codes.delete']));
    $tax = TaxCode::query()->firstOrFail();
    $headers = ['X-Company-Id' => $this->company];
    $this->patchJson('/api/v1/tax-codes/'.$tax->id, ['rate' => '99', 'version' => 1], $headers)->assertForbidden();
    $this->deleteJson('/api/v1/tax-codes/'.$tax->id, ['version' => 1], $headers)->assertForbidden();
});

it('resolves effective tax overrides and isolates other company custom codes', function (): void {
    $this->seed(ReferenceSeeder::class);
    $other = Actors::company();
    app(CompanyContext::class)->runAs($other, function () use ($other): void {
        $secret = TaxCode::factory()->make(['code' => 'SECRET']);
        $secret->setAttribute('company_id', $other)->save();
    });
    Actors::activate($this->company);
    $override = TaxCode::factory()->make(['code' => 'VAT20', 'rate' => '10.0000', 'effective_from' => '2026-01-01']);
    $override->setAttribute('company_id', $this->company)->save();
    $lookup = app(TaxCodeLookup::class);
    expect($lookup->find('VAT20', new DateTimeImmutable('2026-10-20'))?->id)->toBe($override->id)
        ->and($lookup->find('VAT20', new DateTimeImmutable('2025-01-01'))?->rate)->toBe('20.0000')
        ->and($lookup->find('SECRET'))->toBeNull();
});

it('enforces warehouse ownership of nested locations and parents', function (): void {
    $warehouse = Warehouse::factory()->create();
    $another = Warehouse::factory()->create();
    $location = Location::factory()->create(['warehouse_id' => $warehouse->id]);
    Sanctum::actingAs(Actors::user(['warehouses.view', 'warehouses.update']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $this->getJson('/api/v1/warehouses/'.$another->id.'/locations/'.$location->id, $headers)->assertNotFound();
    $this->postJson('/api/v1/warehouses/'.$another->id.'/locations', [
        'code' => 'BAD', 'name' => 'Wrong parent', 'type' => 'bin', 'parent_id' => $location->id,
    ], $headers)->assertUnprocessable();
    $headers['Idempotency-Key'] = (string) Str::uuid();
    $created = $this->postJson('/api/v1/warehouses/'.$warehouse->id.'/locations', [
        'code' => 'GOOD', 'name' => 'Bin', 'type' => 'bin', 'parent_id' => $location->id,
    ], $headers)->assertCreated()->json('data.id');
    $this->patchJson('/api/v1/warehouses/'.$warehouse->id.'/locations/'.$location->id, [
        'parent_id' => $created, 'version' => 1,
    ], $headers)->assertUnprocessable();
});

it('rejects cost center cycles and cross company dimensions', function (): void {
    $parent = CostCenter::factory()->create();
    $child = CostCenter::factory()->create(['parent_id' => $parent->id]);
    $user = Actors::user(['cost_centers.update', 'projects.create']);
    $other = Actors::companyFor($user);
    $foreign = app(CompanyContext::class)->runAs($other, fn () => CostCenter::factory()->create());
    Sanctum::actingAs($user);
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $this->patchJson('/api/v1/cost-centers/'.$parent->id, ['parent_id' => $child->id, 'version' => 1], $headers)->assertUnprocessable();
    $this->postJson('/api/v1/projects', ['code' => 'P1', 'name' => 'Project', 'cost_center_id' => $foreign->id], $headers)->assertUnprocessable();
    expect(app(DimensionLookup::class)->costCenterExists($foreign->id))->toBeFalse();
});

it('provides scoped lookups for active master records', function (): void {
    $this->seed(ReferenceSeeder::class);
    $term = PaymentTerm::factory()->create();
    $warehouse = Warehouse::factory()->create();
    $center = CostCenter::factory()->create();
    $project = Project::factory()->create();
    expect(app(CurrencyLookup::class)->exists('USD'))->toBeTrue()
        ->and(app(CurrencyLookup::class)->exists('usd'))->toBeFalse()
        ->and(app(PaymentTermLookup::class)->exists($term->id))->toBeTrue()
        ->and(app(WarehouseLookup::class)->exists($warehouse->id))->toBeTrue()
        ->and(app(DimensionLookup::class)->costCenterExists($center->id))->toBeTrue()
        ->and(app(DimensionLookup::class)->projectExists($project->id))->toBeTrue();
    $term->setAttribute('is_active', false)->save();
    expect(app(PaymentTermLookup::class)->exists($term->id))->toBeFalse();
});

it('returns latest manual rates and TCMB staleness with authorization', function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->travelTo(now()->setDate(2026, 10, 21)->startOfDay());
    Sanctum::actingAs(Actors::user(['exchange_rates.view']));
    $headers = ['X-Company-Id' => $this->company];
    $this->getJson('/api/v1/exchange-rates/status', $headers)->assertOk()->assertJsonPath('data.is_stale', true)->assertJsonPath('data.stale_days', null);
    ExchangeRate::factory()->create(['rate_date' => '2026-10-16', 'source' => 'tcmb']);
    ExchangeRate::factory()->create(['rate_date' => '2026-10-16', 'source' => 'manual', 'forex_selling' => '36.000000']);
    $this->getJson('/api/v1/exchange-rates/status', $headers)->assertOk()->assertJsonPath('data.stale_days', 5)->assertJsonPath('data.is_stale', true);
    $this->getJson('/api/v1/exchange-rates/latest?currency=USD', $headers)->assertOk()->assertJsonPath('data.forex_selling', '36.000000');
    Actors::revoke(auth()->user(), $this->company);
    $this->getJson('/api/v1/exchange-rates/status', $headers)->assertForbidden();
});

it('creates only manual positive decimal rates and validates currency codes', function (): void {
    $this->travelTo(now()->setDate(2026, 10, 21)->startOfDay());
    $this->seed(ReferenceSeeder::class);
    Sanctum::actingAs(Actors::user(['exchange_rates.manage']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $data = ['currency_code' => 'USD', 'rate_date' => '2026-10-20', 'forex_buying' => '34.000000', 'forex_selling' => '35.000000', 'source' => 'tcmb'];
    $this->postJson('/api/v1/exchange-rates', $data, $headers)->assertCreated()->assertJsonPath('data.source', 'manual');
    $headers['Idempotency-Key'] = (string) Str::uuid();
    $this->postJson('/api/v1/exchange-rates', [...$data, 'currency_code' => 'XXX'], $headers)->assertUnprocessable();
    $headers['Idempotency-Key'] = (string) Str::uuid();
    $this->postJson('/api/v1/exchange-rates', [...$data, 'forex_selling' => 35.2], $headers)->assertUnprocessable();
});

it('registers a company base currency setting with a validated default', function (): void {
    $this->seed(ReferenceSeeder::class);
    $reader = app(SettingsReader::class);
    expect($reader->get('company.base_currency'))->toBe('TRY');
    $user = Actors::user(['settings.view', 'settings.update']);
    $other = Actors::companyFor($user, ['settings.view', 'settings.update']);
    Sanctum::actingAs($user);
    $headers = ['X-Company-Id' => $this->company];
    $this->patchJson('/api/v1/settings', ['settings' => ['company.base_currency' => 'USD']], $headers)->assertOk();
    expect($reader->get('company.base_currency'))->toBe('USD');
    $this->patchJson('/api/v1/settings', ['settings' => ['company.base_currency' => 'XXX']], $headers)->assertUnprocessable();
    expect(app(CompanyContext::class)->runAs($other, fn () => $reader->get('company.base_currency')))->toBe('TRY');
});

it('checks branches and parties through the Organization and Parties lookups of the active company', function (): void {
    $user = Actors::user(['warehouses.create', 'projects.create']);
    $other = Actors::companyFor($user);
    Sanctum::actingAs($user);
    [$branch, $party] = app(CompanyContext::class)->runAs($this->company, fn (): array => [Branch::factory()->create(), Party::factory()->create()]);
    [$foreignBranch, $foreignParty] = app(CompanyContext::class)->runAs($other, fn (): array => [Branch::factory()->create(), Party::factory()->create()]);
    $inactiveBranch = app(CompanyContext::class)->runAs($this->company, fn (): Branch => Branch::factory()->create(['is_active' => false]));
    $post = fn (string $uri, array $data) => $this->postJson($uri, $data, ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()]);

    foreach ([(string) Str::uuid(), $foreignBranch->id, $inactiveBranch->id] as $id) {
        $post('/api/v1/warehouses', ['code' => 'B1', 'name' => 'Branch', 'branch_id' => $id])->assertUnprocessable()->assertJsonValidationErrors(['branch_id'], 'errors.fields');
    }
    foreach ([(string) Str::uuid(), $foreignParty->id] as $id) {
        $post('/api/v1/projects', ['code' => 'P1', 'name' => 'Project', 'party_id' => $id])->assertUnprocessable()->assertJsonValidationErrors(['party_id'], 'errors.fields');
    }
    $post('/api/v1/warehouses', ['code' => 'B1', 'name' => 'Branch', 'branch_id' => $branch->id])->assertCreated()->assertJsonPath('data.branch_id', $branch->id);
    $post('/api/v1/projects', ['code' => 'P1', 'name' => 'Project', 'party_id' => $party->id])->assertCreated()->assertJsonPath('data.party_id', $party->id);

    // Bare install (no Organization / Parties): the fallback lookups verify nothing.
    app()->instance(ExternalReferences::BRANCH_LOOKUP, new NullLookup);
    $post('/api/v1/warehouses', ['code' => 'B2', 'name' => 'Branch', 'branch_id' => $branch->id])->assertUnprocessable();
});

it('maintains one default warehouse and blocks deletion of referenced records', function (): void {
    $one = Warehouse::factory()->create(['is_default' => true]);
    $center = CostCenter::factory()->create();
    Project::factory()->create(['cost_center_id' => $center->id]);
    Sanctum::actingAs(Actors::user(['warehouses.create', 'warehouses.delete', 'cost_centers.delete']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $this->postJson('/api/v1/warehouses', ['code' => 'DEFAULT2', 'name' => 'Default', 'is_default' => true], $headers)->assertCreated();
    expect($one->fresh()->getAttribute('is_default'))->toBeFalse()
        ->and(Warehouse::query()->where('is_default', true)->count())->toBe(1);
    Location::factory()->create(['warehouse_id' => $one->id]);
    $this->deleteJson('/api/v1/warehouses/'.$one->id, ['version' => 2], $headers)->assertUnprocessable();
    $this->deleteJson('/api/v1/cost-centers/'.$center->id, ['version' => 1], $headers)->assertUnprocessable();
});

it('validates decimal bounds and merged effective periods', function (): void {
    Sanctum::actingAs(Actors::user(['tax_codes.create', 'tax_codes.update']));
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $payload = ['code' => 'TAX', 'name' => 'Custom', 'type' => 'vat', 'rate' => '101', 'effective_from' => '2026-01-01'];
    $this->postJson('/api/v1/tax-codes', $payload, $headers)->assertUnprocessable();
    $headers['Idempotency-Key'] = (string) Str::uuid();
    $id = $this->postJson('/api/v1/tax-codes', [...$payload, 'rate' => '20'], $headers)->assertCreated()->json('data.id');
    $this->patchJson('/api/v1/tax-codes/'.$id, ['effective_to' => '2025-01-01', 'version' => 1], $headers)->assertUnprocessable();
});

it('validates list query limits and scopes nested locations to the active company', function (): void {
    $user = Actors::user(['warehouses.view']);
    $other = Actors::companyFor($user, ['warehouses.view']);
    $warehouse = app(CompanyContext::class)->runAs($other, fn () => Warehouse::factory()->create());
    Sanctum::actingAs($user);
    $headers = ['X-Company-Id' => $this->company];
    $this->getJson('/api/v1/warehouses?per_page=101', $headers)->assertUnprocessable();
    $this->getJson('/api/v1/warehouses?sort=company_id', $headers)->assertUnprocessable();
    $this->getJson('/api/v1/warehouses/'.$warehouse->id.'/locations', $headers)->assertNotFound();
});

it('hides foreign custom taxes while leaving global taxes visible', function (): void {
    $this->seed(ReferenceSeeder::class);
    $user = Actors::user(['tax_codes.view', 'tax_codes.update', 'tax_codes.delete']);
    $other = Actors::companyFor($user, ['tax_codes.view', 'tax_codes.update', 'tax_codes.delete']);
    $tax = app(CompanyContext::class)->runAs($other, function () use ($other) {
        $tax = TaxCode::factory()->make(['code' => 'FOREIGN']);
        $tax->setAttribute('company_id', $other)->save();

        return $tax;
    });
    Sanctum::actingAs($user);
    $headers = ['X-Company-Id' => $this->company];
    $this->getJson('/api/v1/tax-codes', $headers)->assertOk()->assertJsonPath('meta.pagination.total', 6);
    $this->getJson('/api/v1/tax-codes/'.$tax->id, $headers)->assertNotFound();
    $this->patchJson('/api/v1/tax-codes/'.$tax->id, ['name' => 'Denied', 'version' => 1], $headers)->assertNotFound();
    $this->deleteJson('/api/v1/tax-codes/'.$tax->id, ['version' => 1], $headers)->assertNotFound();
});

it('checks warehouse permissions on every nested endpoint', function (): void {
    $warehouse = Warehouse::factory()->create();
    $location = Location::factory()->create(['warehouse_id' => $warehouse->id]);
    Sanctum::actingAs(Actors::user());
    $prefix = '/api/v1/warehouses/'.$warehouse->id.'/locations';
    $headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
    $this->getJson($prefix, $headers)->assertForbidden();
    $this->getJson($prefix.'/'.$location->id, $headers)->assertForbidden();
    $this->postJson($prefix, ['code' => 'NEW', 'name' => 'New', 'type' => 'bin'], $headers)->assertForbidden();
    $this->patchJson($prefix.'/'.$location->id, ['name' => 'Denied', 'version' => 1], $headers)->assertForbidden();
    $this->deleteJson($prefix.'/'.$location->id, ['version' => 1], $headers)->assertForbidden();
});

it('writes company-scoped audit entries for master record mutations', function (): void {
    Sanctum::actingAs(Actors::user(['payment_terms.create']));
    $id = $this->postJson('/api/v1/payment-terms', ['code' => 'AUDIT', 'name' => 'Audit', 'due_days' => 10], [
        'X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid(),
    ])->assertCreated()->json('data.id');
    $this->assertDatabaseHas('activity_log', [
        'subject_type' => 'reference_payment_terms', 'subject_id' => $id,
        'company_id' => $this->company, 'event' => 'created',
    ]);
});
