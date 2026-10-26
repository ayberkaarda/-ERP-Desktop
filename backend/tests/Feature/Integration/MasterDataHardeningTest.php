<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Organization\Services\MasterDataIntegrity;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Listeners\SeedCompanyDefaults;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Services\CurrencyCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company()->id;
    $this->other = Identity::company()->id;
});

function integrationMigration(string $path): Migration
{
    return require base_path($path);
}

const CROSS_MODULE_MIGRATION = 'database/migrations/2026_12_09_100100_add_master_data_cross_module_foreign_keys.php';

const COMPANY_MIGRATION = 'app/Modules/Organization/Database/migrations/2026_12_09_200100_add_company_foreign_keys_to_master_data_tables.php';

function constraintState(string $name): ?bool
{
    $row = DB::selectOne('SELECT convalidated FROM pg_constraint WHERE conname = ?', [$name]);

    return $row === null ? null : (bool) $row->convalidated;
}

function partyRow(string $company, array $attributes = []): string
{
    $id = (string) Str::uuid7();
    DB::table('parties')->insert([
        'id' => $id, 'company_id' => $company, 'code' => 'P'.Str::upper(Str::random(6)), 'name' => 'Old party', 'type' => 'company',
        'roles' => '["customer"]', 'tags' => '[]', 'country' => 'DE', 'is_active' => true, 'version' => 1,
        'created_at' => now(), 'updated_at' => now(), ...$attributes,
    ]);

    return $id;
}

it('refuses cross-module keys over orphan rows with counts, repairs on request and then validates the keys', function (): void {
    $migration = integrationMigration(CROSS_MODULE_MIGRATION);
    $migration->down();
    expect(constraintState('parties_payment_term_id_foreign'))->toBeNull();

    // Rows written before the keys existed: two parties with a payment term that is gone, one
    // price list in a currency nobody knows.
    $orphans = [partyRow($this->company, ['payment_term_id' => (string) Str::uuid7()]), partyRow($this->company, ['payment_term_id' => (string) Str::uuid7()])];
    DB::table('price_lists')->insert(['id' => (string) Str::uuid7(), 'company_id' => $this->company, 'code' => 'OLD', 'name' => 'Old', 'currency_code' => 'XAU', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);

    expect(fn () => $migration->up())->toThrow(RuntimeException::class, 'parties.payment_term_id: 2');
    try {
        $migration->up();
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('price_lists.currency_code: 1')->toContain('master-data:repair-orphans --dry-run');
    }
    // Nothing was changed or added by the failed run.
    expect(DB::table('parties')->whereIn('id', $orphans)->whereNotNull('payment_term_id')->count())->toBe(2)
        ->and(constraintState('parties_payment_term_id_foreign'))->toBeNull();

    // Dry run lists, changes nothing; the required currency needs a manual fix (exit 1).
    expect(Artisan::call('master-data:repair-orphans', ['--dry-run' => true]))->toBe(1);
    expect(Artisan::output())->toContain('parties.payment_term_id')->toContain('would be cleared')->toContain('manual fix needed');
    expect(DB::table('parties')->whereIn('id', $orphans)->whereNotNull('payment_term_id')->count())->toBe(2);

    Artisan::call('master-data:repair-orphans');
    expect(DB::table('parties')->whereIn('id', $orphans)->whereNull('payment_term_id')->where('version', 2)->count())->toBe(2)
        ->and(DB::table('price_lists')->where('code', 'OLD')->value('currency_code'))->toBe('XAU');
    expect(fn () => $migration->up())->toThrow(RuntimeException::class, 'price_lists.currency_code: 1');

    // The manual fix, then the migration passes and every key is validated.
    DB::table('price_lists')->where('code', 'OLD')->delete();
    expect(Artisan::call('master-data:repair-orphans', ['--dry-run' => true]))->toBe(0);
    $migration->up();
    foreach (MasterDataIntegrity::crossModuleKeys() as [$table, $column]) {
        expect(constraintState(MasterDataIntegrity::constraintName($table, $column)))->toBeTrue("{$table}.{$column}");
    }
    // Re-running is harmless (keys already present are kept).
    $migration->up();
});

it('refuses company keys over rows of unknown companies and passes on clean data', function (): void {
    $migration = integrationMigration(COMPANY_MIGRATION);
    $migration->down();
    $migration->up();
    expect(constraintState('units_company_id_foreign'))->toBeTrue();

    $migration->down();
    DB::table('units')->insert(['id' => (string) Str::uuid7(), 'company_id' => (string) Str::uuid7(), 'code' => 'LOST', 'name' => 'Lost', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
    expect(fn () => $migration->up())->toThrow(RuntimeException::class, 'units.company_id: 1');
    expect(Artisan::call('master-data:repair-orphans'))->toBe(1);
    expect(Artisan::output())->toContain('units.company_id')->toContain('manual fix needed');
    expect(DB::table('units')->where('code', 'LOST')->exists())->toBeTrue();

    DB::table('units')->where('code', 'LOST')->delete();
    $migration->up();
    expect(constraintState('units_company_id_foreign'))->toBeTrue();
});

it('audits references to records of another company without changing anything', function (): void {
    expect(Artisan::call('master-data:audit-tenancy'))->toBe(0);
    expect(Artisan::output())->toContain('No cross-company references');

    $foreignTerm = app(CompanyContext::class)->runAs($this->other, fn (): string => PaymentTerm::factory()->create()->id);
    $ownTerm = app(CompanyContext::class)->runAs($this->company, fn (): string => PaymentTerm::factory()->create()->id);
    // Seeded global tax codes are shared by every company and are fine.
    $this->seed(ReferenceSeeder::class);
    partyRow($this->company, ['payment_term_id' => $ownTerm]);
    $bad = partyRow($this->company, ['payment_term_id' => $foreignTerm]);
    $before = DB::table('parties')->where('id', $bad)->first();

    expect(Artisan::call('master-data:audit-tenancy'))->toBe(1);
    expect(Artisan::output())->toContain('parties.payment_term_id')->toContain('1');
    expect(DB::table('parties')->where('id', $bad)->first())->toEqual($before);
});

it('does not bring soft deleted seeded tax codes back', function (): void {
    $this->seed(ReferenceSeeder::class);
    $count = TaxCode::query()->withoutGlobalScope('visible')->withTrashed()->count();
    TaxCode::query()->withoutGlobalScope('visible')->whereNull('company_id')->where('code', 'VAT20')->firstOrFail()->delete();

    $this->seed(ReferenceSeeder::class);

    expect(TaxCode::query()->withoutGlobalScope('visible')->whereNull('company_id')->where('code', 'VAT20')->exists())->toBeFalse()
        ->and(TaxCode::query()->withoutGlobalScope('visible')->withTrashed()->count())->toBe($count);
});

/**
 * A second database session in its own process: runs the statements in a transaction, prints
 * "ready", holds the transaction for $holdSeconds and commits. Returns the process handle.
 *
 * @param  list<string>  $statements
 * @return array{0: resource, 1: array<int, resource>}
 */
function holdInOtherSession(array $statements, float $holdSeconds): array
{
    $c = config('database.connections.'.config('database.default'));
    $script = <<<'PHP'
        [$dsn, $user, $password, $statements, $hold] = json_decode($argv[1], true);
        $pdo = new PDO($dsn, $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->beginTransaction();
        foreach ($statements as $sql) { $pdo->exec($sql); }
        echo "ready\n"; flush();
        usleep((int) ($hold * 1000000));
        $pdo->commit();
        echo "done\n";
        PHP;
    $args = json_encode([sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], $c['database']), $c['username'], $c['password'], $statements, $holdSeconds]);
    $process = proc_open([PHP_BINARY, '-r', $script, $args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (! is_resource($process)) {
        throw new RuntimeException('Could not start the second session.');
    }
    $line = fgets($pipes[1]);
    if (trim((string) $line) !== 'ready') {
        throw new RuntimeException('Second session failed: '.$line.stream_get_contents($pipes[2]));
    }

    return [$process, $pipes];
}

/** @param array{0: resource, 1: array<int, resource>} $session */
function finishOtherSession(array $session): string
{
    [$process, $pipes] = $session;
    $out = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
    proc_close($process);

    return (string) $out;
}

it('creates global currencies conflict-safely while another session inserts the same code', function (): void {
    $id = (string) Str::uuid7();
    $session = holdInOtherSession([
        "INSERT INTO currencies (id, code, name, symbol, decimals, is_active, version, created_at, updated_at) VALUES ('{$id}', 'TRY', 'Turkish lira', 'TL', 2, true, 1, now(), now())",
    ], 1.0);

    try {
        $started = microtime(true);
        // Waits for the other session's uncommitted TRY, then skips it instead of failing.
        CurrencyCatalog::ensure(['TRY', 'USD']);
        $waited = microtime(true) - $started;
        expect(finishOtherSession($session))->toContain('done')
            ->and($waited)->toBeGreaterThan(0.5)
            ->and(Currency::query()->where('code', 'TRY')->value('id'))->toBe($id)
            ->and(Currency::query()->whereIn('code', ['TRY', 'USD'])->count())->toBe(2);
    } finally {
        // The other session committed outside the test transaction.
        finishOtherSession(holdInOtherSession(["DELETE FROM currencies WHERE id = '{$id}'"], 0));
    }
});

it('serializes a company bootstrap behind another session holding the company locks', function (): void {
    $session = holdInOtherSession([
        sprintf("SELECT pg_advisory_xact_lock(hashtext('%s'))", SeedCompanyDefaults::lockKey($this->company)),
        sprintf("SELECT pg_advisory_xact_lock(hashtext('%s'))", 'catalog.units.'.$this->company),
    ], 1.0);

    $started = microtime(true);
    CompanyCreated::dispatch($this->company);
    $waited = microtime(true) - $started;
    expect(finishOtherSession($session))->toContain('done')
        ->and($waited)->toBeGreaterThan(0.5);

    // A second bootstrap after the first changes nothing.
    CompanyCreated::dispatch($this->company);
    expect(app(CompanyContext::class)->runAs($this->company, fn (): array => [
        PaymentTerm::query()->count(), Unit::query()->count(), Party::query()->count(),
    ]))->toBe([6, 12, 0]);
});
