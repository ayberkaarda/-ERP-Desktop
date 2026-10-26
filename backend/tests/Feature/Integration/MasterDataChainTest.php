<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Organization\Models\Branch;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

const CHAIN_PERMISSIONS = [
    'currencies.view', 'currencies.update', 'payment_terms.create', 'tax_codes.create', 'cost_centers.create',
    'projects.create', 'warehouses.create', 'parties.view', 'parties.create', 'items.view', 'items.create',
    'units.manage', 'price_lists.view', 'price_lists.create', 'price_lists.update', 'pricing.view',
];

beforeEach(function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->other = Actors::company();
    $this->company = Actors::company();
    $this->user = Actors::user(CHAIN_PERMISSIONS);
    Actors::grant($this->user, $this->other, CHAIN_PERMISSIONS);
});

/**
 * @param  array<string, mixed>  $data
 * @return TestResponse<Response>
 */
function chainPost(User $user, string $company, string $uri, array $data): TestResponse
{
    return Catalog::post($user, $company, $uri, $data);
}

/**
 * The same master data in a company, created over HTTP; returns the ids by name.
 *
 * @return array<string, string>
 */
function buildChain(User $user, string $company): array
{
    $ids = [];
    $ids['term'] = chainPost($user, $company, 'payment-terms', ['code' => 'NET30X', 'name' => '30', 'due_days' => 30])->assertCreated()->json('data.id');
    $ids['tax'] = chainPost($user, $company, 'tax-codes', ['code' => 'OWN20', 'name' => 'Own VAT', 'type' => 'vat', 'rate' => '20', 'effective_from' => '2024-01-01'])->assertCreated()->json('data.id');
    $ids['list'] = chainPost($user, $company, 'price-lists', ['code' => 'VIP', 'name' => 'VIP', 'currency_code' => 'TRY'])->assertCreated()->json('data.id');
    $ids['center'] = chainPost($user, $company, 'cost-centers', ['code' => 'SALES', 'name' => 'Sales'])->assertCreated()->json('data.id');
    $ids['unit'] = chainPost($user, $company, 'units', ['code' => 'EA', 'name' => 'Each'])->assertCreated()->json('data.id');
    $ids['branch'] = app(CompanyContext::class)->runAs($company, fn (): string => Branch::factory()->create()->id);

    return $ids;
}

it('wires parties, items, prices, projects and warehouses to real records of the active company only', function (): void {
    $mine = buildChain($this->user, $this->company);
    $theirs = buildChain($this->user, $this->other);

    // Party with every reference; each foreign-company id is a 422 on its own field.
    $party = ['name' => 'Chain GmbH', 'type' => 'company', 'roles' => ['customer'], 'country' => 'DE',
        'default_currency_code' => 'EUR', 'risk_limit' => '1000', 'risk_currency_code' => 'TRY',
        'payment_term_id' => $mine['term'], 'price_list_id' => $mine['list']];
    foreach (['payment_term_id' => $theirs['term'], 'price_list_id' => $theirs['list'], 'default_currency_code' => 'ZZZ'] as $field => $value) {
        chainPost($this->user, $this->company, 'parties', [...$party, $field => $value])
            ->assertStatus(422)->assertJsonValidationErrors([$field], 'errors.fields');
    }
    $partyId = chainPost($this->user, $this->company, 'parties', $party)->assertCreated()
        ->assertJsonPath('data.payment_term_id', $mine['term'])->assertJsonPath('data.price_list_id', $mine['list'])->json('data.id');
    $foreignParty = chainPost($this->user, $this->other, 'parties', [...$party, 'payment_term_id' => $theirs['term'], 'price_list_id' => $theirs['list']])
        ->assertCreated()->json('data.id');

    // Item with the company's tax code (another company's custom code is invisible).
    $item = ['name' => 'Widget', 'type' => 'stock', 'base_unit_id' => $mine['unit'], 'default_tax_code_id' => $mine['tax']];
    chainPost($this->user, $this->company, 'items', [...$item, 'default_tax_code_id' => $theirs['tax']])
        ->assertStatus(422)->assertJsonValidationErrors(['default_tax_code_id'], 'errors.fields');
    chainPost($this->user, $this->company, 'items', [...$item, 'base_unit_id' => $theirs['unit']])
        ->assertStatus(422)->assertJsonValidationErrors(['base_unit_id'], 'errors.fields');
    $itemId = chainPost($this->user, $this->company, 'items', $item)->assertCreated()->assertJsonPath('data.default_tax_code_id', $mine['tax'])->json('data.id');

    // A default list and the party's own list: the party gets its list's price, others the default.
    $default = chainPost($this->user, $this->company, 'price-lists', ['code' => 'STD', 'name' => 'Standard', 'currency_code' => 'TRY', 'is_default' => true])->assertCreated()->json('data.id');
    chainPost($this->user, $this->company, "price-lists/{$default}/lines", ['item_id' => $itemId, 'unit_id' => $mine['unit'], 'price' => '100'])->assertCreated();
    chainPost($this->user, $this->company, "price-lists/{$mine['list']}/lines", ['item_id' => $itemId, 'unit_id' => $mine['unit'], 'price' => '80'])->assertCreated();
    Catalog::as($this->user, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$itemId}&currency=TRY&party_id={$partyId}")
        ->assertOk()->assertJsonPath('data.unit_price', '80.000000')->assertJsonPath('data.price_list_id', $mine['list'])->assertJsonPath('data.source', 'party_price_list');
    Catalog::as($this->user, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$itemId}&currency=TRY")
        ->assertOk()->assertJsonPath('data.unit_price', '100.000000')->assertJsonPath('data.price_list_id', $default);
    Catalog::as($this->user, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$itemId}&currency=TRY&party_id={$foreignParty}")
        ->assertStatus(422)->assertJsonValidationErrors(['party_id'], 'errors.fields');

    // Project with party and cost center; warehouse with branch.
    $project = ['code' => 'PRJ', 'name' => 'Project', 'party_id' => $partyId, 'cost_center_id' => $mine['center']];
    foreach (['party_id' => $foreignParty, 'cost_center_id' => $theirs['center']] as $field => $value) {
        chainPost($this->user, $this->company, 'projects', [...$project, $field => $value])
            ->assertStatus(422)->assertJsonValidationErrors([$field], 'errors.fields');
    }
    chainPost($this->user, $this->company, 'projects', $project)->assertCreated()
        ->assertJsonPath('data.party_id', $partyId)->assertJsonPath('data.cost_center_id', $mine['center']);
    chainPost($this->user, $this->company, 'warehouses', ['code' => 'WH', 'name' => 'Store', 'branch_id' => $theirs['branch']])
        ->assertStatus(422)->assertJsonValidationErrors(['branch_id'], 'errors.fields');
    chainPost($this->user, $this->company, 'warehouses', ['code' => 'WH', 'name' => 'Store', 'branch_id' => $mine['branch']])
        ->assertCreated()->assertJsonPath('data.branch_id', $mine['branch']);
});

it('declares the integration foreign keys with their delete rules', function (): void {
    $keys = collect(DB::select(<<<'SQL'
        SELECT tc.table_name AS tab, kcu.column_name AS col, ccu.table_name AS ref, rc.delete_rule AS del
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
        SQL))->mapWithKeys(fn (object $k): array => ["{$k->tab}.{$k->col}" => "{$k->ref}:{$k->del}"]);

    foreach (['company_currencies', 'exchange_rates', 'tax_codes', 'payment_terms', 'warehouses', 'locations', 'cost_centers', 'projects',
        'parties', 'party_addresses', 'party_contacts', 'party_bank_accounts', 'units', 'unit_conversions', 'item_categories', 'items',
        'item_variants', 'item_units', 'item_barcodes', 'price_lists', 'price_list_lines', 'discount_rules'] as $table) {
        expect($keys->get("{$table}.company_id"))->toBe('companies:RESTRICT');
    }
    expect($keys->only([
        'parties.payment_term_id', 'parties.price_list_id', 'items.default_tax_code_id', 'items.purchase_tax_code_id',
        'projects.party_id', 'projects.cost_center_id', 'warehouses.branch_id', 'discount_rules.party_id',
        'parties.default_currency_code', 'parties.risk_currency_code', 'party_bank_accounts.currency_code',
        'price_lists.currency_code', 'company_currencies.currency_code', 'exchange_rates.currency_code',
    ])->sortKeys()->all())->toBe(collect([
        'parties.payment_term_id' => 'payment_terms:RESTRICT', 'parties.price_list_id' => 'price_lists:RESTRICT',
        'items.default_tax_code_id' => 'tax_codes:RESTRICT', 'items.purchase_tax_code_id' => 'tax_codes:RESTRICT',
        'projects.party_id' => 'parties:RESTRICT', 'projects.cost_center_id' => 'cost_centers:NO ACTION',
        'warehouses.branch_id' => 'branches:RESTRICT', 'discount_rules.party_id' => 'parties:RESTRICT',
        'parties.default_currency_code' => 'currencies:RESTRICT', 'parties.risk_currency_code' => 'currencies:RESTRICT',
        'party_bank_accounts.currency_code' => 'currencies:RESTRICT', 'price_lists.currency_code' => 'currencies:RESTRICT',
        'company_currencies.currency_code' => 'currencies:RESTRICT', 'exchange_rates.currency_code' => 'currencies:RESTRICT',
    ])->sortKeys()->all());
});

it('refuses a hard delete of a referenced payment term at the database level', function (): void {
    $ids = buildChain($this->user, $this->company);
    chainPost($this->user, $this->company, 'parties', ['name' => 'P', 'type' => 'company', 'roles' => ['customer'], 'country' => 'DE', 'payment_term_id' => $ids['term']])->assertCreated();

    expect(fn () => DB::transaction(fn () => DB::table('payment_terms')->where('id', $ids['term'])->delete()))
        ->toThrow(QueryException::class);
    expect(DB::table('payment_terms')->where('id', $ids['term'])->exists())->toBeTrue();
});
