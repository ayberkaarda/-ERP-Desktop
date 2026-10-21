<?php

declare(strict_types=1);

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
    $this->company = Actors::company();
    $this->manager = Actors::user(['parties.view', 'parties.create', 'parties.update']);
    $this->term = (string) Str::uuid7();
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
    $term = test()->term;
    app()->instance(PartiesTestPaymentTermLookup::class, new class($term) implements PartiesTestPaymentTermLookup
    {
        public function __construct(private readonly string $term) {}

        public function exists(string $id): bool
        {
            return $id === $this->term;
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

it('accepts opaque values while the providing modules are not installed', function (): void {
    $guards = app(ReferenceGuards::class);

    expect(interface_exists(ReferenceGuards::CURRENCY) && app()->bound(ReferenceGuards::CURRENCY))->toBeFalse()
        ->and($guards->currencyExists('XYZ'))->toBeTrue()
        ->and($guards->paymentTermExists((string) Str::uuid7()))->toBeTrue()
        ->and($guards->priceListExists((string) Str::uuid7()))->toBeTrue();

    guardedPost($this->manager, $this->company, ['default_currency_code' => 'XYZ', 'price_list_id' => (string) Str::uuid7()])->assertCreated();
});

it('validates references through the providing module contracts once they are bound', function (): void {
    guardedParties();

    guardedPost($this->manager, $this->company, ['default_currency_code' => 'XYZ'])
        ->assertStatus(422)->assertJsonValidationErrors(['default_currency_code'], 'errors.fields');
    guardedPost($this->manager, $this->company, ['risk_limit' => '10', 'risk_currency_code' => 'GBP'])
        ->assertStatus(422)->assertJsonValidationErrors(['risk_currency_code'], 'errors.fields');
    guardedPost($this->manager, $this->company, ['payment_term_id' => (string) Str::uuid7()])
        ->assertStatus(422)->assertJsonValidationErrors(['payment_term_id'], 'errors.fields');

    // Interface exists but nothing is bound: still opaque.
    guardedPost($this->manager, $this->company, [
        'default_currency_code' => 'EUR', 'risk_limit' => '10', 'risk_currency_code' => 'TRY',
        'payment_term_id' => $this->term, 'price_list_id' => (string) Str::uuid7(),
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
