<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Inventory\Contracts\Reservations;
use App\Modules\Inventory\Data\ReservationRequest;
use App\Modules\Inventory\Services\InventoryRules;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Tests\Support\Companies;
use Tests\Support\Inventory\Inv;

/*
 * Committed data and two real connections (no wrapping test transaction): a posting or reservation
 * holds the pair lock until it commits, so a second one on the same stock waits and then sees the
 * reduced availability. Everything created here is removed in afterEach (triggers bypassed there only).
 */

beforeEach(function (): void {
    if (! Schema::hasTable('stock_movements')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    Inv::boot();
    config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('pgsql_second');
    $this->company = Companies::make();
    app(CompanyContext::class)->set($this->company);
    app(ChartSeeder::class)->seed(ExpenseScheme::A);
    app(FiscalCalendar::class)->create(['code' => '2027', 'start_date' => '2027-01-01', 'end_date' => '2027-12-31']);
    app(DeterminationRules::class)->ensureDefaults(ExpenseScheme::A);
    app(InventoryRules::class)->ensureDefaults($this->company);
    $this->wh = Inv::warehouse($this->company)->id;
    $this->item = Inv::item($this->company)->id;
    Inv::receive($this->company, $this->wh, $this->item, '5', '10');
});

afterEach(function (): void {
    DB::setDefaultConnection('pgsql');

    foreach ([$this->a, $this->b] as $connection) {
        while ($connection->transactionLevel() > 0) {
            $connection->rollBack();
        }
        $connection->statement('RESET lock_timeout');
    }

    $this->a->statement('SET session_replication_role = replica');
    foreach ([
        'stock_cost_layers', 'stock_movements', 'stock_balances', 'stock_valuations', 'stock_reservations', 'stock_document_lines', 'stock_documents',
        'stock_serials', 'stock_lots', 'stock_warehouse_settings', 'journal_lines', 'account_balances', 'journal_entries', 'account_determination_rules',
        'accounts', 'accounting_periods', 'fiscal_years', 'number_sequences', 'activity_log', 'items', 'units', 'locations', 'warehouses', 'settings',
    ] as $table) {
        $this->a->table($table)->where('company_id', $this->company)->delete();
    }
    $this->a->statement('SET session_replication_role = DEFAULT');
    Companies::remove($this->company);
    app(CompanyContext::class)->clear();
    DB::purge('pgsql_second');
});

/** Runs $fn on the second connection with a short lock timeout. */
function onSecond(Closure $fn): mixed
{
    DB::setDefaultConnection('pgsql_second');
    DB::connection('pgsql_second')->statement("SET lock_timeout = '300ms'");

    try {
        return $fn();
    } finally {
        DB::connection('pgsql_second')->statement('RESET lock_timeout');
        DB::setDefaultConnection('pgsql');
    }
}

it('never oversells when two connections issue the same stock', function (): void {
    $this->a->beginTransaction();
    Inv::issue($this->company, $this->wh, $this->item, '4');

    // The second issue waits for the first one's pair lock...
    expect(fn () => onSecond(fn () => Inv::issue($this->company, $this->wh, $this->item, '4')))->toThrow(QueryException::class, 'lock timeout');

    $this->a->commit();

    // ...and after the commit it sees only 1 left.
    expect(fn () => onSecond(fn () => Inv::issue($this->company, $this->wh, $this->item, '4')))->toThrow(ValidationException::class, 'Not enough stock');
    expect(Inv::onHand($this->company, $this->item, $this->wh))->toBe('1.000000')
        ->and($this->a->table('stock_movements')->where('company_id', $this->company)->where('direction', 'out')->count())->toBe(1);
});

it('serializes reservations of the last units under a hard policy', function (): void {
    Inv::policy($this->company, $this->wh, 'hard');
    $reserve = fn () => app(Reservations::class)->reserve(new ReservationRequest($this->company, $this->item, $this->wh, '4'));

    $this->a->beginTransaction();
    $reserve();

    expect(fn () => onSecond($reserve))->toThrow(QueryException::class, 'lock timeout');
    $this->a->commit();
    expect(fn () => onSecond($reserve))->toThrow(ValidationException::class, 'available');

    expect($this->a->table('stock_reservations')->where('company_id', $this->company)->count())->toBe(1)
        ->and((string) $this->a->table('stock_balances')->where('company_id', $this->company)->sum('reserved'))->toBe('4.000000');
});

it('makes an issue wait for a reservation of the same stock and then respect it', function (): void {
    Inv::policy($this->company, $this->wh, 'hard');

    $this->a->beginTransaction();
    app(Reservations::class)->reserve(new ReservationRequest($this->company, $this->item, $this->wh, '3'));

    expect(fn () => onSecond(fn () => Inv::issue($this->company, $this->wh, $this->item, '3')))->toThrow(QueryException::class, 'lock timeout');
    $this->a->commit();
    expect(fn () => onSecond(fn () => Inv::issue($this->company, $this->wh, $this->item, '3')))->toThrow(ValidationException::class, 'reserved');

    onSecond(fn () => Inv::issue($this->company, $this->wh, $this->item, '2'));
    expect(Inv::onHand($this->company, $this->item, $this->wh))->toBe('3.000000');
});
