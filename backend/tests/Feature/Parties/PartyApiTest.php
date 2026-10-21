<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Identity\Models\Activity;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Contracts\PartyUsageChecker;
use App\Modules\Parties\Database\factories\PartyFactory;
use App\Modules\Parties\Events\PartyCreated;
use App\Modules\Parties\Events\PartyUpdated;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Services\PartyService;
use App\Modules\Parties\Validation\Tckn;
use App\Modules\Parties\Validation\Vkn;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Models\PaymentTerm;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

const PARTIES_ALL = ['parties.view', 'parties.create', 'parties.update', 'parties.delete', 'parties.export'];

beforeEach(function (): void {
    $this->other = Actors::company();
    $this->otherAdmin = Actors::user(PARTIES_ALL);
    $this->company = Actors::company();
    $this->manager = Actors::user(PARTIES_ALL);
    $this->viewer = Actors::user(['parties.view']);
    $this->member = Actors::user([]);
    $this->foreignParty = app(CompanyContext::class)->runAs($this->other, fn (): Party => Party::factory()->create([
        'name' => 'Acme Teknoloji A.Ş.', 'tax_number' => '1234567890',
    ]));
    $this->payload = [
        'name' => 'Acme Teknoloji', 'legal_name' => 'Acme Teknoloji Anonim Şirketi', 'type' => 'company',
        'roles' => ['supplier', 'customer'], 'tax_office' => 'Kadıköy', 'tax_number' => '4840847211', 'country' => 'TR',
    ];
});

function partiesAs(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user, 'sanctum');
}

/** @return array<string, string> */
function partiesHeaders(string $company, bool $idempotent = false): array
{
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $company];

    return $idempotent ? [...$headers, 'Idempotency-Key' => (string) Str::uuid7()] : $headers;
}

function partiesCreate(User $user, string $company, array $payload): TestResponse
{
    return partiesAs($user)->postJson('/api/v1/parties', $payload, partiesHeaders($company, true));
}

function partyIn(string $company, array $attributes = []): Party
{
    return app(CompanyContext::class)->runAs($company, fn (): Party => Party::factory()->create($attributes));
}

it('creates a party with a sequence code, normalized roles, audit entry and event', function (): void {
    Event::fake([PartyCreated::class]);

    $response = partiesCreate($this->manager, $this->company, $this->payload)->assertCreated()
        ->assertJsonPath('data.code', 'P000001')
        ->assertJsonPath('data.roles', ['customer', 'supplier'])
        ->assertJsonPath('data.version', 1)
        ->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.company_id', $this->company)
        ->assertJsonPath('data.tags', []);
    $id = $response->json('data.id');

    partiesCreate($this->manager, $this->company, [...$this->payload, 'tax_number' => '1234567890'])
        ->assertCreated()->assertJsonPath('data.code', 'P000002');
    // Sequences are per company.
    partiesCreate($this->otherAdmin, $this->other, [...$this->payload, 'tax_number' => '0123456789'])
        ->assertCreated()->assertJsonPath('data.code', 'P000001');

    Event::assertDispatched(PartyCreated::class, fn (PartyCreated $e): bool => $e->partyId === $id && $e->companyId === $this->company);
    $log = Activity::withoutCompanyScope()->where('subject_id', $id)->where('event', 'created')->firstOrFail();
    expect($log->company_id)->toBe($this->company)
        ->and($log->attribute_changes?->get('attributes')['tax_number'] ?? null)->toBe('4840847211');
});

it('refuses client codes and versions on create and needs an idempotency key', function (): void {
    partiesCreate($this->manager, $this->company, [...$this->payload, 'code' => 'X1'])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    partiesCreate($this->manager, $this->company, [...$this->payload, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    partiesAs($this->manager)->postJson('/api/v1/parties', $this->payload, partiesHeaders($this->company))
        ->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');

    $headers = partiesHeaders($this->company, true);
    $first = partiesAs($this->manager)->postJson('/api/v1/parties', $this->payload, $headers)->assertCreated();
    partiesAs($this->manager)->postJson('/api/v1/parties', $this->payload, $headers)
        ->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first->json('data.id'));
    expect(Party::withoutCompanyScope()->where('company_id', $this->company)->count())->toBe(1);
});

it('validates tax numbers by party type and country', function (array $override, ?string $field, bool $withReference = false): void {
    // Without seeded reference data the bound Reference lookups cannot confirm a currency or term.
    if ($withReference) {
        $this->seed(ReferenceSeeder::class);
    }
    $response = partiesCreate($this->manager, $this->company, [...$this->payload, ...$override]);

    $field === null
        ? $response->assertCreated()
        : $response->assertStatus(422)->assertJsonValidationErrors([$field], 'errors.fields');
})->with([
    'company with bad VKN' => [['tax_number' => '4840847212'], 'tax_number'],
    'company with a TCKN' => [['tax_number' => '10000000146'], 'tax_number'],
    'person with TCKN' => [['type' => 'person', 'tax_number' => '10000000146'], null],
    'person with bad TCKN' => [['type' => 'person', 'tax_number' => '10000000147'], 'tax_number'],
    'person with a VKN' => [['type' => 'person', 'tax_number' => '4840847211'], 'tax_number'],
    'separators are stripped' => [['tax_number' => '484 084 72-11'], null],
    'foreign free form' => [['country' => 'de', 'tax_number' => 'DE 123456789'], null],
    'foreign formula' => [['country' => 'DE', 'tax_number' => '=1+1'], 'tax_number'],
    'no tax number' => [['tax_number' => null], null],
    'no roles' => [['roles' => []], 'roles'],
    'unknown role' => [['roles' => ['customer', 'partner']], 'roles.1'],
    'repeated role' => [['roles' => ['customer', 'customer']], 'roles.0'],
    'unknown type' => [['type' => 'robot'], 'type'],
    'bad country' => [['country' => 'TUR'], 'country'],
    'bad currency' => [['default_currency_code' => 'TL'], 'default_currency_code'],
    'bad payment term' => [['payment_term_id' => 'net-30'], 'payment_term_id'],
    'negative risk' => [['risk_limit' => '-1', 'risk_currency_code' => 'TRY'], 'risk_limit'],
    'risk without currency' => [['risk_limit' => '1000'], 'risk_currency_code'],
    'risk with default currency' => [['risk_limit' => '1000', 'default_currency_code' => 'try'], null, true],
    'unverifiable currency' => [['default_currency_code' => 'TRY'], 'default_currency_code'],
    'unverifiable payment term' => [['payment_term_id' => '01890000-0000-7000-8000-000000000000'], 'payment_term_id'],
    'unverifiable price list' => [['price_list_id' => '01890000-0000-7000-8000-000000000000'], 'price_list_id'],
    'country with trailing newline' => [['country' => 'DE
', 'tax_number' => 'X1', 'payment_term_id' => null], null],
    'too many tags' => [['tags' => array_map(fn (int $i): string => "t{$i}", range(1, 21))], 'tags'],
]);

it('stores money as a scale 4 string and normalizes codes', function (): void {
    $this->seed(ReferenceSeeder::class);
    $term = app(CompanyContext::class)->runAs($this->company, fn (): PaymentTerm => PaymentTerm::factory()->create());
    partiesCreate($this->manager, $this->company, [
        ...$this->payload, 'risk_limit' => 1500.5, 'risk_currency_code' => 'usd', 'default_currency_code' => 'eur',
        'tags' => ['vip', 'vip', 'north'], 'payment_term_id' => $term->id,
    ])->assertCreated()
        ->assertJsonPath('data.payment_term_id', $term->id)
        ->assertJsonPath('data.risk_limit', '1500.5000')
        ->assertJsonPath('data.risk_currency_code', 'USD')
        ->assertJsonPath('data.default_currency_code', 'EUR')
        ->assertJsonPath('data.tags', ['vip', 'north']);
});

it('keeps tax numbers unique among the active parties of a company only', function (): void {
    partiesCreate($this->manager, $this->company, $this->payload)->assertCreated();

    // Same number in another company is fine (done in beforeEach for 1234567890), here it is taken.
    partiesCreate($this->manager, $this->company, [...$this->payload, 'name' => 'Copy'])
        ->assertStatus(422)->assertJsonValidationErrors(['tax_number'], 'errors.fields');

    // An inactive record may share it, but cannot be re-activated while the active one exists.
    $inactive = partiesCreate($this->manager, $this->company, [...$this->payload, 'name' => 'Old', 'is_active' => false])
        ->assertCreated()->json('data');
    partiesAs($this->manager)->patchJson("/api/v1/parties/{$inactive['id']}", ['is_active' => true, 'version' => 1], partiesHeaders($this->company))
        ->assertStatus(422)->assertJsonValidationErrors(['tax_number'], 'errors.fields');

    partiesCreate($this->manager, $this->company, [...$this->payload, 'tax_number' => '1234567890'])->assertCreated();
});

it('maps the partial unique index to a 422 on tax_number when validation is bypassed', function (): void {
    app(CompanyContext::class)->set($this->company);
    $service = app(PartyService::class);
    $service->create([...$this->payload, 'roles' => ['customer']]);

    try {
        $service->create([...$this->payload, 'roles' => ['customer']]);
        $this->fail('expected a validation error');
    } catch (ApiException $e) {
        expect($e->status())->toBe(422)->and(array_keys($e->fields ?? []))->toBe(['tax_number']);
    }

    // A soft deleted party frees its tax number; the rolled back attempt returned its number.
    Party::query()->firstOrFail()->delete();
    expect($service->create([...$this->payload, 'roles' => ['customer']])->code)->toBe('P000002');
});

it('updates with optimistic locking and validates against the stored state', function (): void {
    Event::fake([PartyUpdated::class]);
    $party = partiesCreate($this->manager, $this->company, $this->payload)->json('data');
    $url = "/api/v1/parties/{$party['id']}";
    $h = partiesHeaders($this->company);

    partiesAs($this->manager)->patchJson($url, ['name' => 'No version'], $h)
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    partiesAs($this->manager)->patchJson($url, ['name' => 'Renamed', 'version' => 1], $h)
        ->assertOk()->assertJsonPath('data.version', 2)->assertJsonPath('data.name', 'Renamed')->assertJsonPath('data.code', 'P000001');
    partiesAs($this->manager)->patchJson($url, ['name' => 'Stale', 'version' => 1], $h)
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    // Turning the company into a person while it keeps its VKN is invalid.
    partiesAs($this->manager)->patchJson($url, ['type' => 'person', 'version' => 2], $h)
        ->assertStatus(422)->assertJsonValidationErrors(['tax_number'], 'errors.fields');
    partiesAs($this->manager)->patchJson($url, ['type' => 'person', 'tax_number' => '10000000146', 'version' => 2], $h)
        ->assertOk()->assertJsonPath('data.version', 3);
    partiesAs($this->manager)->patchJson($url, ['code' => 'HACK', 'version' => 3], $h)->assertStatus(422);
    partiesAs($this->manager)->patchJson($url, ['roles' => [], 'version' => 3], $h)
        ->assertStatus(422)->assertJsonValidationErrors(['roles'], 'errors.fields');

    Event::assertDispatched(PartyUpdated::class, fn (PartyUpdated $e): bool => $e->changed === ['name']);
    Event::assertDispatched(PartyUpdated::class, fn (PartyUpdated $e): bool => $e->changed === ['type', 'tax_number']);
    Event::assertDispatchedTimes(PartyUpdated::class, 2);

    $log = Activity::withoutCompanyScope()->where('subject_id', $party['id'])->where('event', 'updated')->oldest('id')->firstOrFail();
    expect($log->attribute_changes?->get('old'))->toBe(['name' => 'Acme Teknoloji']);
});

it('lists with search, role and status filters inside the active company only', function (): void {
    partyIn($this->company, ['name' => 'Kuzey Lojistik', 'tax_number' => '0123456789', 'roles' => ['supplier']]);
    partyIn($this->company, ['name' => 'Güney Gıda', 'code' => 'P900001', 'tax_number' => '1234567890', 'roles' => ['customer']]);
    partyIn($this->company, ['name' => 'Batı Yapı', 'roles' => ['customer', 'supplier'], 'is_active' => false]);
    $h = partiesHeaders($this->company);
    $names = fn (string $query): array => partiesAs($this->viewer)->getJson("/api/v1/parties{$query}", $h)->assertOk()->json('data.*.name');

    expect($names('?sort=name'))->toBe(['Batı Yapı', 'Güney Gıda', 'Kuzey Lojistik'])
        ->and($names('?q=lojist'))->toBe(['Kuzey Lojistik'])
        ->and($names('?q=P90000'))->toBe(['Güney Gıda'])
        ->and($names('?q=123456'))->toBe(['Kuzey Lojistik', 'Güney Gıda'])
        ->and($names('?filter[role]=supplier&sort=name'))->toBe(['Batı Yapı', 'Kuzey Lojistik'])
        ->and($names('?filter[role]=customer,supplier&sort=name'))->toBe(['Batı Yapı', 'Güney Gıda', 'Kuzey Lojistik'])
        ->and($names('?filter[is_active]=0'))->toBe(['Batı Yapı'])
        ->and($names('?filter[role]=customer&filter[is_active]=1'))->toBe(['Güney Gıda'])
        // The other company's "Acme" never shows up.
        ->and($names('?q=Acme'))->toBe([]);

    partiesAs($this->viewer)->getJson('/api/v1/parties?filter[role]=partner', $h)->assertStatus(422);
    partiesAs($this->viewer)->getJson('/api/v1/parties?filter[company_id]=x', $h)->assertStatus(422);
    partiesAs($this->viewer)->getJson('/api/v1/parties?per_page=1', $h)->assertOk()
        ->assertJsonPath('meta.pagination.total', 3)->assertJsonCount(1, 'data');
});

it('enforces permissions on every endpoint', function (): void {
    $party = partyIn($this->company);
    $h = partiesHeaders($this->company);
    $url = "/api/v1/parties/{$party->id}";

    partiesAs($this->member)->getJson('/api/v1/parties', $h)->assertForbidden();
    partiesAs($this->member)->getJson($url, $h)->assertForbidden();
    partiesAs($this->member)->getJson('/api/v1/parties/duplicates?name=x', $h)->assertForbidden();
    partiesAs($this->member)->getJson("{$url}/addresses", $h)->assertForbidden();

    partiesAs($this->viewer)->getJson($url, $h)->assertOk();
    partiesAs($this->viewer)->getJson("{$url}/contacts", $h)->assertOk();
    partiesCreate($this->viewer, $this->company, $this->payload)->assertForbidden();
    // Authorization runs before validation: no validation details leak to callers without access.
    partiesCreate($this->viewer, $this->company, [])->assertForbidden();
    partiesAs($this->viewer)->patchJson($url, ['name' => 'x', 'version' => 1], $h)->assertForbidden();
    partiesAs($this->viewer)->patchJson($url, [], $h)->assertForbidden();
    partiesAs($this->viewer)->deleteJson($url, ['version' => 1], $h)->assertForbidden();
    partiesAs($this->viewer)->getJson('/api/v1/parties/export', $h)->assertForbidden();
    partiesAs($this->viewer)->postJson("{$url}/addresses", ['type' => 'billing', 'line1' => 'x'], partiesHeaders($this->company, true))->assertForbidden();

    // Not a member of the other company at all.
    partiesAs($this->viewer)->getJson('/api/v1/parties', partiesHeaders($this->other))->assertForbidden();
    partiesAs($this->viewer)->getJson('/api/v1/parties', ['Accept' => 'application/json'])->assertStatus(400);
    $this->app['auth']->forgetGuards();
    Identity::fresh();
    $this->getJson('/api/v1/parties', $h)->assertUnauthorized();
});

it('never exposes or changes parties of another company', function (): void {
    $id = $this->foreignParty->id;
    $h = partiesHeaders($this->company);

    partiesAs($this->manager)->getJson("/api/v1/parties/{$id}", $h)->assertNotFound();
    partiesAs($this->manager)->patchJson("/api/v1/parties/{$id}", ['name' => 'Mine', 'version' => 1], $h)->assertNotFound();
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$id}", ['version' => 1], $h)->assertNotFound();
    partiesAs($this->manager)->getJson("/api/v1/parties/{$id}/addresses", $h)->assertNotFound();
    partiesAs($this->manager)->postJson("/api/v1/parties/{$id}/addresses", ['type' => 'billing', 'line1' => 'x'], partiesHeaders($this->company, true))->assertNotFound();
    partiesAs($this->manager)->getJson('/api/v1/parties/not-a-uuid', $h)->assertNotFound();

    expect(Party::withoutCompanyScope()->findOrFail($id)->name)->toBe('Acme Teknoloji A.Ş.');
});

it('shows a party with its addresses, contacts and bank accounts', function (): void {
    $party = partyIn($this->company);
    app(CompanyContext::class)->runAs($this->company, function () use ($party): void {
        $party->addresses()->create(['type' => 'billing', 'line1' => 'Bağdat Cd. 1', 'country' => 'TR']);
        $party->contacts()->create(['name' => 'Ayşe Yılmaz']);
        $party->bankAccounts()->create(['bank_name' => 'Bank', 'iban' => 'TR330006100519786457841326']);
    });

    partiesAs($this->viewer)->getJson("/api/v1/parties/{$party->id}", partiesHeaders($this->company))->assertOk()
        ->assertJsonPath('data.addresses.0.line1', 'Bağdat Cd. 1')
        ->assertJsonPath('data.contacts.0.name', 'Ayşe Yılmaz')
        ->assertJsonPath('data.bank_accounts.0.iban', 'TR330006100519786457841326');
});

it('soft deletes an unused party and deactivates one that is in use', function (): void {
    $unused = partyIn($this->company);
    $used = partyIn($this->company);
    $h = partiesHeaders($this->company);

    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$unused->id}", [], $h)
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$unused->id}", ['version' => 7], $h)->assertStatus(409);
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$unused->id}?version=1", [], $h)->assertNoContent();
    expect(Party::withoutCompanyScope()->withTrashed()->findOrFail($unused->id)->trashed())->toBeTrue();
    partiesAs($this->manager)->getJson("/api/v1/parties/{$unused->id}", $h)->assertNotFound();

    $usedId = $used->id;
    $this->app->instance('test.usage', new class($usedId) implements PartyUsageChecker
    {
        public function __construct(private readonly string $id) {}

        public function isInUse(string $companyId, string $partyId): bool
        {
            return $partyId === $this->id;
        }
    });
    $this->app->tag(['test.usage'], PartyUsageChecker::TAG);

    Event::fake([PartyUpdated::class]);
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$used->id}", ['version' => 1], $h)->assertOk()
        ->assertJsonPath('meta.action', 'deactivated')
        ->assertJsonPath('data.is_active', false)
        ->assertJsonPath('data.version', 2);
    Event::assertDispatched(PartyUpdated::class, fn (PartyUpdated $e): bool => $e->changed === ['is_active']);
    expect(Party::withoutCompanyScope()->findOrFail($used->id)->is_active)->toBeFalse();
});

it('finds duplicates by exact tax number and similar names inside the company', function (): void {
    $exact = partyIn($this->company, ['name' => 'Totally Different', 'tax_number' => '4840847211']);
    $similar = partyIn($this->company, ['name' => 'Acme Teknoloji Ltd', 'tax_number' => '0123456789']);
    $legal = partyIn($this->company, ['name' => 'Short', 'legal_name' => 'Acme Teknolojı A.Ş.', 'tax_number' => null]);
    partyIn($this->company, ['name' => 'Unrelated Gıda', 'tax_number' => '1234567890']);
    $h = partiesHeaders($this->company);

    $data = partiesAs($this->viewer)->getJson('/api/v1/parties/duplicates?tax_number=484+084+7211&name=Acme+Teknoloji', $h)->assertOk()->json('data');
    $ids = array_column($data, 'id');

    expect($ids[0])->toBe($exact->id)
        ->and($data[0]['reasons'])->toBe(['tax_number'])
        ->and($ids)->toContain($similar->id, $legal->id)
        ->and($ids)->not->toContain($this->foreignParty->id)
        ->and(count($ids))->toBe(3);

    $byName = collect($data)->firstWhere('id', $similar->id);
    expect($byName['reasons'])->toBe(['name'])->and($byName['similarity'])->toBeGreaterThan(0.3);

    // The other company has an exact match for this tax number; it must never leak.
    partiesAs($this->viewer)->getJson('/api/v1/parties/duplicates?tax_number=1234567890', $h)->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Unrelated Gıda');
    partiesAs($this->viewer)->getJson("/api/v1/parties/duplicates?tax_number=4840847211&exclude_id={$exact->id}", $h)->assertOk()
        ->assertJsonCount(0, 'data');
    partiesAs($this->viewer)->getJson('/api/v1/parties/duplicates', $h)
        ->assertStatus(422)->assertJsonValidationErrors(['tax_number', 'name'], 'errors.fields');
    partiesAs($this->viewer)->getJson('/api/v1/parties/duplicates?exclude_id=nope&name=x', $h)->assertStatus(422);
});

it('exports the filtered list as CSV with formula cells neutralised', function (): void {
    partyIn($this->company, ['name' => '=HYPERLINK("http://x")', 'roles' => ['supplier']]);
    partyIn($this->company, ['name' => 'Plain Customer', 'roles' => ['customer']]);
    $h = partiesHeaders($this->company);

    $csv = partiesAs($this->manager)->get('/api/v1/parties/export?filter[role]=supplier', $h)->assertOk()->streamedContent();

    expect($csv)->toContain("'=HYPERLINK")->not->toContain('Plain Customer')->not->toContain('Acme')
        ->and(str_starts_with($csv, "\xEF\xBB\xBFcode,name"))->toBeTrue();

    $all = partiesAs($this->manager)->get('/api/v1/parties/export?q=plain', $h)->assertOk()->streamedContent();
    expect($all)->toContain('Plain Customer')->not->toContain('HYPERLINK');

    partiesAs($this->manager)->get('/api/v1/parties/export?format=pdf', $h)->assertStatus(422);
    partiesAs($this->manager)->get('/api/v1/parties/export?format=xlsx', $h)->assertOk()
        ->assertDownload();
});

it('serves the PartyLookup contract scoped to the active company', function (): void {
    $party = partyIn($this->company, ['code' => 'P123456', 'roles' => ['customer', 'supplier'], 'risk_limit' => '250.5', 'risk_currency_code' => 'TRY']);
    $lookup = app(PartyLookup::class);

    app(CompanyContext::class)->set($this->company);
    $data = $lookup->find($party->id);

    expect($data)->not->toBeNull()
        ->and($data->code)->toBe('P123456')
        ->and($data->riskLimit)->toBe('250.5000')
        ->and($data->isCustomer())->toBeTrue()
        ->and($data->isSupplier())->toBeTrue()
        ->and($lookup->findByCode('P123456')?->id)->toBe($party->id)
        ->and($lookup->exists($party->id))->toBeTrue()
        ->and($lookup->find($this->foreignParty->id))->toBeNull()
        ->and($lookup->findByCode($this->foreignParty->code))->toBeNull()
        ->and($lookup->exists($this->foreignParty->id))->toBeFalse()
        ->and($lookup->find('nope'))->toBeNull()
        ->and(fn () => $data->code = 'x')->toThrow(Error::class);

    $party->delete();
    expect($lookup->find($party->id))->toBeNull();
});

it('generates valid tax numbers in the factory', function (): void {
    foreach (range(1, 20) as $ignored) {
        expect(Vkn::isValid(PartyFactory::vkn()))->toBeTrue()
            ->and(Tckn::isValid(PartyFactory::tckn()))->toBeTrue();
    }
});

it('treats spacing, case and separators of foreign tax numbers as the same number', function (): void {
    $german = [...$this->payload, 'country' => 'DE', 'tax_number' => 'DE123456789'];
    $id = partiesCreate($this->manager, $this->company, $german)->assertCreated()->json('data.id');

    foreach (['de123456789', 'DE 123456789', 'DE-123.456/789'] as $variant) {
        partiesCreate($this->manager, $this->company, [...$german, 'tax_number' => $variant])
            ->assertStatus(422)->assertJsonValidationErrors(['tax_number'], 'errors.fields');
    }

    app(CompanyContext::class)->set($this->company);
    expect(fn () => app(PartyService::class)->create([...$german, 'tax_number' => 'de 123 456 789']))
        ->toThrow(ApiException::class);
    expect(Party::query()->findOrFail($id)->tax_number_canonical)->toBe('DE123456789');

    partiesAs($this->viewer)->getJson('/api/v1/parties/duplicates?tax_number=de+123.456.789&country=DE', partiesHeaders($this->company))
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.reasons', ['tax_number']);
});

it('authorizes deletes before validating the version', function (): void {
    $party = partyIn($this->company);
    $contact = app(CompanyContext::class)->runAs($this->company, fn () => $party->contacts()->create(['name' => 'C']));
    $h = partiesHeaders($this->company);

    partiesAs($this->viewer)->deleteJson("/api/v1/parties/{$party->id}", [], $h)->assertForbidden();
    partiesAs($this->viewer)->deleteJson("/api/v1/parties/{$party->id}/contacts/{$contact->id}", [], $h)->assertForbidden();
    partiesAs($this->member)->deleteJson("/api/v1/parties/{$party->id}", [], $h)->assertForbidden();
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$this->foreignParty->id}", [], $h)->assertNotFound();
    partiesAs($this->manager)->deleteJson("/api/v1/parties/{$party->id}", [], $h)->assertStatus(422);
});

it('reads exports in chunks of the exported columns only', function (): void {
    partyIn($this->company, ['name' => 'Chunked', 'notes' => str_repeat('n', 5000)]);
    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    $csv = partiesAs($this->manager)->get('/api/v1/parties/export', partiesHeaders($this->company))->assertOk()->streamedContent();
    $reads = array_values(array_filter($queries, fn (string $sql): bool => str_starts_with($sql, 'select') && str_contains($sql, 'from "parties"') && ! str_contains($sql, 'count(')));
    $exportRead = end($reads);

    expect($csv)->toContain('Chunked')->not->toContain('nnnnnnnn')
        ->and($exportRead)->not->toContain('notes')->not->toContain('"parties".*')->not->toContain('select *')
        ->and($exportRead)->toContain('limit 1000');
});

it('enforces the export cap inside the snapshot that is streamed', function (): void {
    config(['parties.export_max_rows' => 2]);
    partyIn($this->company, ['name' => 'Row One']);
    partyIn($this->company, ['name' => 'Row Two']);
    $h = partiesHeaders($this->company);

    $response = partiesAs($this->manager)->get('/api/v1/parties/export', $h)->assertOk();
    // Rows that arrive after the first check but before streaming must not slip past the cap.
    partyIn($this->company, ['name' => 'Row Three']);
    $csv = $response->streamedContent();

    expect($csv)->toContain(__('parties::messages.export_too_large', ['max' => 2]))->not->toContain('Row One');

    partiesAs($this->manager)->get('/api/v1/parties/export', $h)->assertStatus(422);
    partiesAs($this->manager)->get('/api/v1/parties/export?format=xlsx', $h)->assertStatus(422);
});
