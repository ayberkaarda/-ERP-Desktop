<?php

declare(strict_types=1);

/*
 * Committed data (no wrapping test transaction): after-commit events and row locks need real
 * commits and a second connection. Everything created here is removed in afterEach.
 */

use App\Core\Company\CompanyContext;
use App\Core\Documents\VersionConflictException;
use App\Modules\Parties\Events\PartyCreated;
use App\Modules\Parties\Events\PartyUpdated;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyContact;
use App\Modules\Parties\Services\PartyChildService;
use App\Modules\Parties\Services\PartyService;
use App\Modules\Parties\Support\ExportSnapshot;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\Support\Companies;

beforeEach(function (): void {
    if (! Schema::hasTable('parties')) {
        Artisan::call('migrate', ['--force' => true]);
    }
    $this->company = Companies::make();
    app(CompanyContext::class)->set($this->company);
    $this->service = app(PartyService::class);
    $this->data = ['name' => 'Committed', 'type' => 'company', 'roles' => ['customer'], 'country' => 'TR', 'tax_number' => '4840847211'];
});

afterEach(function (): void {
    if (isset($this->locker) && $this->locker->transactionLevel() > 0) {
        $this->locker->rollBack();
    }
    DB::statement('RESET lock_timeout');
    $ids = DB::table('parties')->where('company_id', $this->company)->pluck('id')->all();
    foreach (['party_addresses', 'party_contacts', 'party_bank_accounts'] as $table) {
        DB::table($table)->where('company_id', $this->company)->delete();
    }
    DB::table('parties')->where('company_id', $this->company)->delete();
    DB::table('activity_log')->where('company_id', $this->company)->delete();
    DB::table('number_sequences')->where('company_id', $this->company)->delete();
    Companies::remove($this->company);
    expect(DB::table('parties')->whereIn('id', $ids)->count())->toBe(0);
});

it('dispatches party events only after commit and returns rolled back numbers', function (): void {
    $created = [];
    $updated = [];
    Event::listen(PartyCreated::class, function (PartyCreated $e) use (&$created): void {
        $created[] = $e->partyId;
    });
    Event::listen(PartyUpdated::class, function (PartyUpdated $e) use (&$updated): void {
        $updated[] = $e->changed;
    });

    $party = DB::transaction(function () use (&$created): Party {
        $party = $this->service->create($this->data);
        expect($created)->toBe([]);

        return $party;
    });
    expect($created)->toBe([$party->id])->and($party->code)->toBe('P000001');

    try {
        DB::transaction(function (): void {
            $this->service->create([...$this->data, 'tax_number' => '1234567890']);

            throw new RuntimeException('abort');
        });
    } catch (RuntimeException) {
    }
    expect($created)->toHaveCount(1);

    $this->service->update($party, ['name' => 'Renamed', 'version' => 1]);
    expect($updated)->toBe([['name']])
        ->and($this->service->create([...$this->data, 'tax_number' => '1234567890'])->code)->toBe('P000002');
});

it('makes sub-resource writes wait for the party row lock', function (): void {
    $party = $this->service->create($this->data);
    $children = app(PartyChildService::class);
    $children->create($party, PartyContact::class, ['name' => 'First', 'is_primary' => true]);

    config(['database.connections.parties_lock' => config('database.connections.pgsql')]);
    $this->locker = DB::connection('parties_lock');
    $this->locker->beginTransaction();
    // NO KEY UPDATE does not conflict with the KEY SHARE lock the child foreign key takes, so only
    // the explicit party row lock of the service can make the writer wait here.
    $this->locker->select('select id from parties where id = ? for no key update', [$party->id]);

    DB::statement("SET lock_timeout = '300ms'");
    $error = null;
    try {
        $children->create($party, PartyContact::class, ['name' => 'Second', 'is_primary' => true]);
    } catch (QueryException $e) {
        $error = $e->getCode();
    }
    // 55P03 = lock_not_available: the writer queued behind the party row lock.
    expect($error)->toBe('55P03')
        ->and(PartyContact::query()->where('party_id', $party->id)->count())->toBe(1);

    $this->locker->rollBack();
    $second = $children->create($party, PartyContact::class, ['name' => 'Second', 'is_primary' => true]);

    expect(PartyContact::query()->where('party_id', $party->id)->orderBy('name')->pluck('is_primary', 'name')->all())
        ->toBe(['First' => false, 'Second' => true])
        ->and($second->is_primary)->toBeTrue();
});

it('makes concurrent party updates conflict instead of losing writes', function (): void {
    $party = $this->service->create($this->data);
    $stale = Party::query()->findOrFail($party->id);
    $this->service->update($party, ['name' => 'First writer', 'version' => 1]);

    expect(fn () => $this->service->update($stale, ['name' => 'Second writer', 'version' => 1]))
        ->toThrow(VersionConflictException::class);
    expect(Party::query()->findOrFail($party->id)->name)->toBe('First writer');
});

it('runs exports in one repeatable read snapshot', function (): void {
    $this->service->create($this->data);
    config(['database.connections.parties_lock' => config('database.connections.pgsql')]);
    $this->locker = DB::connection('parties_lock');

    [$level, $before, $after] = app(ExportSnapshot::class)->run(function (): array {
        $level = DB::selectOne("select current_setting('transaction_isolation') as level")->level;
        $before = Party::query()->count();
        // A concurrent commit is invisible inside the snapshot.
        $this->locker->table('parties')->insert([
            'company_id' => $this->company, 'code' => 'X1', 'name' => 'Concurrent', 'type' => 'company', 'roles' => '["customer"]',
        ]);

        return [$level, $before, Party::query()->count()];
    });

    expect($level)->toBe('repeatable read')->and($before)->toBe(1)->and($after)->toBe(1)
        ->and(Party::query()->count())->toBe(2);
});
