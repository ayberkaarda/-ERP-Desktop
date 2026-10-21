<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Models\Activity;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyAddress;
use App\Modules\Parties\Models\PartyBankAccount;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->other = Actors::company();
    $this->company = Actors::company();
    $this->editor = Actors::user(['parties.view', 'parties.update']);
    $this->viewer = Actors::user(['parties.view']);
    $this->party = childPartyIn($this->company);
    $this->sibling = childPartyIn($this->company);
    $this->foreign = childPartyIn($this->other);
    $this->base = "/api/v1/parties/{$this->party->id}";
});

function childPartyIn(string $company): Party
{
    return app(CompanyContext::class)->runAs($company, fn (): Party => Party::factory()->create(['country' => 'DE', 'tax_number' => null]));
}

function childAs(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user, 'sanctum');
}

/** @return array<string, string> */
function childHeaders(string $company, bool $idempotent = false): array
{
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $company];

    return $idempotent ? [...$headers, 'Idempotency-Key' => (string) Str::uuid7()] : $headers;
}

/** @return array<string, mixed> */
function childPost(User $user, string $company, string $url, array $payload, int $status = 201): array
{
    return childAs($user)->postJson($url, $payload, childHeaders($company, true))->assertStatus($status)->json('data') ?? [];
}

/** @return array<string, bool> */
function defaultsOf(string $partyId): array
{
    return app(CompanyContext::class)->runAs(test()->company, fn (): array => PartyAddress::query()->where('party_id', $partyId)
        ->orderBy('created_at')->orderBy('id')->get()->mapWithKeys(fn (PartyAddress $a): array => [$a->label => $a->is_default])->all());
}

it('keeps a single default address per type and party', function (): void {
    $url = "{$this->base}/addresses";
    $first = childPost($this->editor, $this->company, $url, ['type' => 'billing', 'label' => 'b1', 'line1' => 'A Sk. 1', 'is_default' => true]);
    expect($first['country'])->toBe('DE')->and($first['is_default'])->toBeTrue();

    childPost($this->editor, $this->company, $url, ['type' => 'shipping', 'label' => 's1', 'line1' => 'B Sk. 2', 'is_default' => true, 'country' => 'tr']);
    childPost($this->editor, $this->company, $url, ['type' => 'billing', 'label' => 'b2', 'line1' => 'C Sk. 3', 'is_default' => true]);
    // Another party's defaults are independent.
    childPost($this->editor, $this->company, "/api/v1/parties/{$this->sibling->id}/addresses", ['type' => 'billing', 'label' => 'x', 'line1' => 'X', 'is_default' => true]);

    expect(defaultsOf($this->party->id))->toBe(['b1' => false, 's1' => true, 'b2' => true])
        ->and(defaultsOf($this->sibling->id))->toBe(['x' => true]);

    // The cleared default was saved as a new version and audited.
    $b1 = app(CompanyContext::class)->runAs($this->company, fn (): PartyAddress => PartyAddress::query()->findOrFail($first['id']));
    expect($b1->version)->toBe(2)
        ->and(Activity::withoutCompanyScope()->where('subject_id', $b1->id)->where('event', 'updated')->value('company_id'))->toBe($this->company);

    // Moving the shipping default into billing takes the billing default away from b2.
    $s1 = childAs($this->viewer)->getJson($url, childHeaders($this->company))->assertOk()->json('data');
    $shipping = collect($s1)->firstWhere('label', 's1');
    childAs($this->editor)->patchJson("{$url}/{$shipping['id']}", ['type' => 'billing', 'version' => 1], childHeaders($this->company))
        ->assertOk()->assertJsonPath('data.type', 'billing')->assertJsonPath('data.version', 2);
    expect(defaultsOf($this->party->id))->toBe(['b1' => false, 's1' => true, 'b2' => false]);

    // Defaults come first in the list.
    expect(childAs($this->viewer)->getJson($url, childHeaders($this->company))->json('data.0.label'))->toBe('s1');
});

it('backs the default rule with partial unique indexes', function (): void {
    app(CompanyContext::class)->set($this->company);
    $this->party->addresses()->create(['type' => 'billing', 'line1' => 'x', 'country' => 'TR', 'is_default' => true]);

    expect(fn () => DB::transaction(fn () => $this->party->addresses()->create(['type' => 'billing', 'line1' => 'y', 'country' => 'TR', 'is_default' => true])))
        ->toThrow(UniqueConstraintViolationException::class);
    expect(fn () => DB::transaction(function (): void {
        $this->party->contacts()->create(['name' => 'a', 'is_primary' => true]);
        $this->party->contacts()->create(['name' => 'b', 'is_primary' => true]);
    }))->toThrow(UniqueConstraintViolationException::class);
    expect(fn () => DB::transaction(function (): void {
        $this->party->bankAccounts()->create(['bank_name' => 'a', 'iban' => 'TR330006100519786457841326', 'is_default' => true]);
        $this->party->bankAccounts()->create(['bank_name' => 'b', 'iban' => 'TR320010009999901234567890', 'is_default' => true]);
    }))->toThrow(UniqueConstraintViolationException::class);
});

it('validates addresses and requires versions on change', function (): void {
    $url = "{$this->base}/addresses";
    childPost($this->editor, $this->company, $url, ['type' => 'home', 'line1' => 'x'], 422);
    childPost($this->editor, $this->company, $url, ['type' => 'billing'], 422);
    childPost($this->editor, $this->company, $url, ['type' => 'billing', 'line1' => 'x', 'country' => 'TUR'], 422);
    childPost($this->editor, $this->company, $url, ['type' => 'billing', 'line1' => 'x', 'version' => 1], 422);
    $address = childPost($this->editor, $this->company, $url, ['type' => 'other', 'line1' => 'x', 'city' => 'İzmir']);
    $item = "{$url}/{$address['id']}";
    $h = childHeaders($this->company);

    childAs($this->editor)->patchJson($item, ['city' => 'Ankara'], $h)->assertStatus(422);
    childAs($this->editor)->patchJson($item, ['city' => 'Ankara', 'version' => 1], $h)->assertOk()->assertJsonPath('data.city', 'Ankara');
    childAs($this->editor)->patchJson($item, ['city' => 'Bursa', 'version' => 1], $h)->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    childAs($this->viewer)->getJson($item, $h)->assertOk()->assertJsonPath('data.version', 2);
    childAs($this->editor)->deleteJson($item, ['version' => 1], $h)->assertStatus(409);
    childAs($this->editor)->deleteJson($item, ['version' => 2], $h)->assertNoContent();
    childAs($this->viewer)->getJson($item, $h)->assertNotFound();
});

it('keeps one primary contact and validates contact fields', function (): void {
    $url = "{$this->base}/contacts";
    $a = childPost($this->editor, $this->company, $url, ['name' => 'Ayşe', 'email' => ' ayse@example.com ', 'is_primary' => true]);
    expect($a['email'])->toBe('ayse@example.com');
    $b = childPost($this->editor, $this->company, $url, ['name' => 'Mehmet', 'phone' => '+90 (212) 555-00-00', 'is_primary' => true]);
    childPost($this->editor, $this->company, $url, ['name' => 'Bad', 'email' => 'not-an-email'], 422);
    childPost($this->editor, $this->company, $url, ['name' => 'Bad', 'phone' => 'call me'], 422);

    $list = childAs($this->viewer)->getJson($url, childHeaders($this->company))->assertOk()->json('data');
    expect(array_column($list, 'is_primary', 'name'))->toBe(['Mehmet' => true, 'Ayşe' => false])
        ->and($b['is_primary'])->toBeTrue();
});

it('validates and normalizes IBANs, unique per party, with a single default', function (): void {
    $url = "{$this->base}/bank-accounts";
    $first = childPost($this->editor, $this->company, $url, [
        'bank_name' => 'Ziraat', 'iban' => 'tr33 0006 1005 1978 6457 8413 26', 'swift' => 'tczbtr2a', 'currency_code' => 'try', 'is_default' => true,
    ]);
    expect($first['iban'])->toBe('TR330006100519786457841326')->and($first['swift'])->toBe('TCZBTR2A')->and($first['currency_code'])->toBe('TRY');

    $invalid = childAs($this->editor)->postJson($url, ['bank_name' => 'x', 'iban' => 'TR330006100519786457841327'], childHeaders($this->company, true))
        ->assertStatus(422)->json('errors.fields.iban.0');
    expect($invalid)->toBe(__('parties::messages.invalid_iban'));
    childPost($this->editor, $this->company, $url, ['bank_name' => 'x', 'iban' => 'TR080006110519786457841326'], 422);
    childPost($this->editor, $this->company, $url, ['bank_name' => 'x', 'iban' => 'TR330006100519786457841326'], 422);
    childPost($this->editor, $this->company, $url, ['bank_name' => 'x', 'iban' => 'DE89370400440532013000', 'swift' => 'BAD'], 422);

    // The same IBAN may belong to another party.
    childPost($this->editor, $this->company, "/api/v1/parties/{$this->sibling->id}/bank-accounts", ['bank_name' => 'x', 'iban' => 'TR330006100519786457841326']);

    $second = childPost($this->editor, $this->company, $url, ['bank_name' => 'Deutsche', 'iban' => 'DE89 3704 0044 0532 0130 00', 'currency_code' => 'EUR', 'is_default' => true]);
    $defaults = app(CompanyContext::class)->runAs($this->company, fn (): array => PartyBankAccount::query()->where('party_id', $this->party->id)->pluck('is_default', 'iban')->all());
    expect($defaults)->toBe(['TR330006100519786457841326' => false, 'DE89370400440532013000' => true]);

    // Updating with its own IBAN is not a duplicate.
    childAs($this->editor)->patchJson("{$url}/{$second['id']}", ['iban' => 'DE89370400440532013000', 'bank_name' => 'DB', 'version' => 1], childHeaders($this->company))
        ->assertOk()->assertJsonPath('data.bank_name', 'DB');
    childAs($this->editor)->patchJson("{$url}/{$second['id']}", ['iban' => 'TR330006100519786457841326', 'version' => 2], childHeaders($this->company))
        ->assertStatus(422)->assertJsonValidationErrors(['iban'], 'errors.fields');
});

it('resolves children only through their own party and company', function (): void {
    $own = childPost($this->editor, $this->company, "{$this->base}/contacts", ['name' => 'Own']);
    $siblingContact = childPost($this->editor, $this->company, "/api/v1/parties/{$this->sibling->id}/contacts", ['name' => 'Sibling']);
    $foreignContact = app(CompanyContext::class)->runAs($this->other, fn () => $this->foreign->contacts()->create(['name' => 'Foreign']));
    $h = childHeaders($this->company);

    // A child id of another party under this party's path is not found.
    childAs($this->editor)->getJson("{$this->base}/contacts/{$siblingContact['id']}", $h)->assertNotFound();
    childAs($this->editor)->patchJson("{$this->base}/contacts/{$siblingContact['id']}", ['name' => 'x', 'version' => 1], $h)->assertNotFound();
    childAs($this->editor)->deleteJson("{$this->base}/contacts/{$siblingContact['id']}", ['version' => 1], $h)->assertNotFound();
    childAs($this->editor)->getJson("{$this->base}/contacts/{$foreignContact->id}", $h)->assertNotFound();
    childAs($this->editor)->getJson("/api/v1/parties/{$this->foreign->id}/contacts/{$foreignContact->id}", $h)->assertNotFound();
    childAs($this->editor)->patchJson("/api/v1/parties/{$this->foreign->id}/contacts/{$foreignContact->id}", ['name' => 'x', 'version' => 1], $h)->assertNotFound();
    childAs($this->editor)->getJson("{$this->base}/addresses/{$own['id']}", $h)->assertNotFound();

    // Viewers read, but never write.
    childAs($this->viewer)->getJson("{$this->base}/contacts/{$own['id']}", $h)->assertOk();
    childAs($this->viewer)->patchJson("{$this->base}/contacts/{$own['id']}", ['name' => 'x', 'version' => 1], $h)->assertForbidden();
    childAs($this->viewer)->deleteJson("{$this->base}/contacts/{$own['id']}", ['version' => 1], $h)->assertForbidden();
    childAs($this->viewer)->postJson("{$this->base}/bank-accounts", ['bank_name' => 'x', 'iban' => 'bad'], childHeaders($this->company, true))->assertForbidden();

    expect(app(CompanyContext::class)->runAs($this->other, fn () => $this->foreign->contacts()->value('name')))->toBe('Foreign');
});
