<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Parties\Support\ReferenceGuards;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

interface PartiesTestCurrencyLookup
{
    public function exists(string $code): bool;
}

interface PartiesTestPaymentTermLookup
{
    public function exists(string $id): bool;
}

interface PartiesTestUnboundLookup
{
    public function exists(string $id): bool;
}

beforeEach(function (): void {
    $this->other = Actors::company();
    $this->company = Actors::company();
    $this->manager = Actors::user(['parties.view', 'parties.create', 'parties.update']);
    $this->term = (string) Str::uuid7();
    $this->foreignTerm = (string) Str::uuid7();
});

function guardedParties(): void
{
    app()->bind(ReferenceGuards::class, fn ($app): ReferenceGuards => new ReferenceGuards($app, [
        'currency' => PartiesTestCurrencyLookup::class,
        'payment_term' => PartiesTestPaymentTermLookup::class,
        'price_list' => PartiesTestUnboundLookup::class,
    ]));
    app()->instance(PartiesTestCurrencyLookup::class, new class implements PartiesTestCurrencyLookup
    {
        public function exists(string $code): bool
        {
            return in_array($code, ['TRY', 'EUR'], true);
        }
    });
    // Company scoped like the real lookup: each term exists in its own company only.
    $terms = [test()->company => test()->term, test()->other => test()->foreignTerm];
    app()->instance(PartiesTestPaymentTermLookup::class, new class($terms) implements PartiesTestPaymentTermLookup
    {
        /** @param array<string, string> $terms */
        public function __construct(private readonly array $terms) {}

        public function exists(string $id): bool
        {
            $company = app(CompanyContext::class)->idOrNull();

            return $company !== null && ($this->terms[$company] ?? null) === $id;
        }
    });
}

function guardedPost(User $user, string $company, array $payload): TestResponse
{
    Identity::fresh();

    return test()->actingAs($user, 'sanctum')->postJson('/api/v1/parties', [
        'name' => 'Ref Test', 'type' => 'company', 'roles' => ['customer'], 'country' => 'DE', ...$payload,
    ], ['Accept' => 'application/json', 'X-Company-Id' => $company, 'Idempotency-Key' => (string) Str::uuid7()]);
}

it('rejects unverifiable references unless explicitly allowed', function (): void {
    $guards = app(ReferenceGuards::class);
    app(CompanyContext::class)->set($this->company);

    expect(interface_exists(ReferenceGuards::CURRENCY) && app()->bound(ReferenceGuards::CURRENCY))->toBeFalse()
        ->and(config('parties.allow_unverified_references'))->toBeFalse()
        ->and($guards->currencyExists('TRY'))->toBeFalse()
        ->and($guards->paymentTermExists((string) Str::uuid7()))->toBeFalse()
        ->and($guards->priceListExists((string) Str::uuid7()))->toBeFalse();

    guardedPost($this->manager, $this->company, ['default_currency_code' => 'TRY'])
        ->assertStatus(422)->assertJsonValidationErrors(['default_currency_code'], 'errors.fields');
    guardedPost($this->manager, $this->company, ['price_list_id' => (string) Str::uuid7()])
        ->assertStatus(422)->assertJsonValidationErrors(['price_list_id'], 'errors.fields');

    config(['parties.allow_unverified_references' => true]);
    expect($guards->currencyExists('XYZ'))->toBeTrue();
    guardedPost($this->manager, $this->company, ['default_currency_code' => 'XYZ', 'price_list_id' => (string) Str::uuid7()])->assertCreated();

    // Without an active company nothing is verified, even when allowed.
    app(CompanyContext::class)->clear();
    expect($guards->currencyExists('XYZ'))->toBeFalse();
});

it('validates references through the providing module contracts once they are bound', function (): void {
    guardedParties();

    guardedPost($this->manager, $this->company, ['default_currency_code' => 'XYZ'])
        ->assertStatus(422)->assertJsonValidationErrors(['default_currency_code'], 'errors.fields');
    guardedPost($this->manager, $this->company, ['risk_limit' => '10', 'risk_currency_code' => 'GBP'])
        ->assertStatus(422)->assertJsonValidationErrors(['risk_currency_code'], 'errors.fields');
    guardedPost($this->manager, $this->company, ['payment_term_id' => (string) Str::uuid7()])
        ->assertStatus(422)->assertJsonValidationErrors(['payment_term_id'], 'errors.fields');
    // A payment term of another company does not exist here.
    guardedPost($this->manager, $this->company, ['payment_term_id' => $this->foreignTerm])
        ->assertStatus(422)->assertJsonValidationErrors(['payment_term_id'], 'errors.fields');
    // Interface exists but nothing is bound: unverifiable, so rejected by default.
    guardedPost($this->manager, $this->company, ['price_list_id' => (string) Str::uuid7()])
        ->assertStatus(422)->assertJsonValidationErrors(['price_list_id'], 'errors.fields');

    guardedPost($this->manager, $this->company, [
        'default_currency_code' => 'EUR', 'risk_limit' => '10', 'risk_currency_code' => 'TRY', 'payment_term_id' => $this->term,
    ])->assertCreated()->assertJsonPath('data.payment_term_id', $this->term);
});

it('checks bank account currencies through the same guard', function (): void {
    guardedParties();
    $party = guardedPost($this->manager, $this->company, [])->assertCreated()->json('data.id');
    Identity::fresh();
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $this->company];

    $this->actingAs($this->manager, 'sanctum')->postJson("/api/v1/parties/{$party}/bank-accounts", [
        'bank_name' => 'x', 'iban' => 'DE89370400440532013000', 'currency_code' => 'USD',
    ], [...$headers, 'Idempotency-Key' => (string) Str::uuid7()])->assertStatus(422)->assertJsonValidationErrors(['currency_code'], 'errors.fields');
    $this->actingAs($this->manager, 'sanctum')->postJson("/api/v1/parties/{$party}/bank-accounts", [
        'bank_name' => 'x', 'iban' => 'DE89370400440532013000', 'currency_code' => 'EUR',
    ], [...$headers, 'Idempotency-Key' => (string) Str::uuid7()])->assertCreated();
});
