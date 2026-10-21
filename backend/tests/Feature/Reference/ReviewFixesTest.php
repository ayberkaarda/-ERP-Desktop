<?php

declare(strict_types=1);

use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Exceptions\InvalidRateFeed;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Services\TcmbRateFetcher;
use Brick\Math\BigDecimal;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    Actors::activate($this->company);
    $this->headers = fn (): array => ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid()];
});

it('accepts array fields on create and update', function (): void {
    Sanctum::actingAs(Actors::user(['warehouses.view', 'warehouses.create', 'warehouses.update', 'tax_codes.create']));
    $id = $this->postJson('/api/v1/warehouses', ['code' => 'W1', 'name' => 'Main', 'address' => ['city' => 'Ankara']], ($this->headers)())
        ->assertCreated()->assertJsonPath('data.address.city', 'Ankara')->json('data.id');
    $this->patchJson('/api/v1/warehouses/'.$id, ['address' => ['city' => 'İzmir'], 'version' => 1], ($this->headers)())
        ->assertOk()->assertJsonPath('data.address.city', 'İzmir');
    $this->postJson('/api/v1/tax-codes', ['code' => 'M1', 'name' => 'Meta', 'type' => 'vat', 'rate' => '1', 'effective_from' => '2026-01-01', 'meta' => ['note' => 'x']], ($this->headers)())
        ->assertCreated()->assertJsonPath('data.meta.note', 'x');
});

it('applies cross-field rules of a partial update to the merged record', function (): void {
    Sanctum::actingAs(Actors::user(['payment_terms.view', 'payment_terms.update']));
    $term = PaymentTerm::factory()->create(['due_days' => 30]);
    $this->patchJson('/api/v1/payment-terms/'.$term->id, ['discount_days' => 5, 'version' => 1], ($this->headers)())->assertOk()
        ->assertJsonPath('data.discount_days', 5);
    $this->patchJson('/api/v1/payment-terms/'.$term->id, ['discount_days' => 40, 'version' => 2], ($this->headers)())->assertUnprocessable()
        ->assertJsonValidationErrorFor('discount_days', 'errors.fields');
});

it('rejects overlapping periods of one tax code and allows consecutive ones', function (): void {
    Sanctum::actingAs(Actors::user(['tax_codes.view', 'tax_codes.create', 'tax_codes.update']));
    $base = ['code' => 'OVL', 'name' => 'Overlap', 'type' => 'vat', 'rate' => '20'];
    $id = $this->postJson('/api/v1/tax-codes', [...$base, 'effective_from' => '2026-01-01'], ($this->headers)())->assertCreated()->json('data.id');
    $this->postJson('/api/v1/tax-codes', [...$base, 'rate' => '10', 'effective_from' => '2026-06-01', 'effective_to' => '2026-06-30'], ($this->headers)())
        ->assertUnprocessable();
    $this->patchJson('/api/v1/tax-codes/'.$id, ['effective_to' => '2026-05-31', 'version' => 1], ($this->headers)())->assertOk();
    $this->postJson('/api/v1/tax-codes', [...$base, 'rate' => '10', 'effective_from' => '2026-06-01', 'effective_to' => '2026-06-30'], ($this->headers)())
        ->assertCreated();
    $this->patchJson('/api/v1/tax-codes/'.$id, ['effective_to' => '2026-06-15', 'version' => 2], ($this->headers)())->assertUnprocessable();
});

it('blocks overlapping tax periods in the database for writers racing past the application check', function (): void {
    $row = fn (string $from, ?string $to, ?string $company = null): array => [
        'id' => (string) Str::uuid7(), 'company_id' => $company, 'type' => 'vat', 'code' => 'RACE', 'name' => 'Race', 'rate' => '20',
        'effective_from' => $from, 'effective_to' => $to, 'created_at' => now(), 'updated_at' => now(),
    ];
    DB::table('tax_codes')->insert($row('2026-01-01', null));
    expect(fn () => DB::transaction(fn () => DB::table('tax_codes')->insert($row('2026-03-01', '2026-03-31'))))->toThrow(QueryException::class);
    DB::table('tax_codes')->insert($row('2026-03-01', '2026-03-31', $this->company));
    expect(fn () => DB::transaction(fn () => DB::table('tax_codes')->insert($row('2026-03-15', null, $this->company))))->toThrow(QueryException::class);
    DB::table('tax_codes')->insert($row('2025-01-01', '2025-12-31'));
    expect(DB::table('tax_codes')->where('code', 'RACE')->count())->toBe(3);
});

it('never rounds a tiny positive cross rate to zero', function (): void {
    $this->seed(ReferenceSeeder::class);
    ExchangeRate::factory()->create(['currency_code' => 'KRW', 'forex_selling' => '0.000001']);
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'forex_selling' => '100.000000']);
    $rate = app(ExchangeRateProvider::class)->rate('KRW', 'USD', new DateTimeImmutable('2026-10-20'));
    expect(BigDecimal::of($rate)->isPositive())->toBeTrue()->and($rate)->toBe('0.00000001')
        ->and(app(ExchangeRateProvider::class)->rate('USD', 'KRW', new DateTimeImmutable('2026-10-20')))->toBe('100000000.000000');
});

it('checks the resource permission before looking up or validating', function (): void {
    PaymentTerm::factory()->create();
    $missing = (string) Str::uuid7();
    Sanctum::actingAs(Actors::user(['payment_terms.view']));
    $this->patchJson('/api/v1/payment-terms/'.$missing, ['name' => 'x', 'version' => 1], ($this->headers)())->assertForbidden();
    $this->deleteJson('/api/v1/payment-terms/'.$missing, ['version' => 1], ($this->headers)())->assertForbidden();
    $this->postJson('/api/v1/payment-terms', [], ($this->headers)())->assertForbidden();
    Sanctum::actingAs(Actors::user([]));
    $this->getJson('/api/v1/payment-terms/'.$missing, ($this->headers)())->assertForbidden();
});

it('rejects the whole feed when a regular currency lacks a rate', function (string $field): void {
    $this->seed(ReferenceSeeder::class);
    $xml = (string) file_get_contents(base_path('tests/Fixtures/Reference/today.xml'));
    $broken = preg_replace('#<'.$field.'>34\.\d+</'.$field.'>#', '<'.$field.'/>', $xml, 1);
    Http::fake(['www.tcmb.gov.tr/*' => Http::response($broken, 200)]);
    try {
        app(TcmbRateFetcher::class)->import();
        $this->fail('The incomplete feed was accepted.');
    } catch (InvalidRateFeed $exception) {
        expect($exception->currency)->toBe('USD')->and($exception->getMessage())->toContain('USD');
    }
    expect(ExchangeRate::query()->count())->toBe(0);
})->with(['ForexBuying', 'ForexSelling']);

it('bounds manual rate dates by the Istanbul calendar day', function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->travelTo(Carbon::parse('2026-10-20 22:30:00', 'UTC'));
    Sanctum::actingAs(Actors::user(['exchange_rates.manage']));
    $data = ['currency_code' => 'USD', 'forex_buying' => '34.000000', 'forex_selling' => '35.000000'];
    $this->postJson('/api/v1/exchange-rates', [...$data, 'rate_date' => '2026-10-21'], ($this->headers)())->assertCreated();
    $this->postJson('/api/v1/exchange-rates', [...$data, 'rate_date' => '2026-10-22'], ($this->headers)())->assertUnprocessable();
});

it('schedules the daily TCMB import at 16:00 Istanbul time', function (): void {
    $events = collect(app(Schedule::class)->events())->filter(fn (Event $event): bool => str_contains((string) $event->command, 'rates:fetch-tcmb'));
    expect($events)->toHaveCount(1);
    $event = $events->first();
    expect($event->expression)->toBe('0 16 * * *')
        ->and($event->timezone)->toBe('Europe/Istanbul')
        ->and($event->withoutOverlapping)->toBeTrue()
        ->and($event->onOneServer)->toBeTrue();
});

it('grants every default role read access to reference data', function (): void {
    $catalog = new PermissionCatalog(app_path('Modules'));
    foreach (['Sales', 'Viewer', 'Accountant', 'Purchasing', 'Warehouse', 'HR'] as $role) {
        expect($catalog->grantsFor($role))->toContain('currencies.view', 'tax_codes.view', 'payment_terms.view', 'warehouses.view', 'cost_centers.view', 'projects.view', 'exchange_rates.view');
    }
});

it('serializes two connections writing overlapping tax periods at the same time', function (): void {
    // Two real sessions outside the test transaction; rows are cleaned up at the end.
    foreach (['race_a', 'race_b'] as $name) {
        config(['database.connections.'.$name => config('database.connections.'.config('database.default'))]);
    }
    [$a, $b] = [DB::connection('race_a'), DB::connection('race_b')];
    $row = fn (string $from): array => [
        'id' => (string) Str::uuid7(), 'type' => 'vat', 'code' => 'RACE2', 'name' => 'Race', 'rate' => '20',
        'effective_from' => $from, 'created_at' => now(), 'updated_at' => now(),
    ];
    try {
        $a->beginTransaction();
        $a->table('tax_codes')->insert($row('2026-01-01'));
        $b->statement("SET lock_timeout = '500ms'");
        // B has to wait for A's uncommitted conflicting period instead of slipping in beside it.
        expect(fn () => $b->transaction(fn () => $b->table('tax_codes')->insert($row('2026-02-01'))))
            ->toThrow(QueryException::class, '55P03');
        $a->commit();
        expect(fn () => $b->transaction(fn () => $b->table('tax_codes')->insert($row('2026-02-01'))))
            ->toThrow(QueryException::class, '23P01');
    } finally {
        if ($a->transactionLevel() > 0) {
            $a->rollBack();
        }
        $a->table('tax_codes')->where('code', 'RACE2')->delete();
        $a->disconnect();
        $b->disconnect();
    }
    expect(DB::table('tax_codes')->where('code', 'RACE2')->count())->toBe(0);
});
