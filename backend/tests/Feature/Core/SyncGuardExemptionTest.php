<?php

declare(strict_types=1);

use App\Core\Sync\Schema\Syncable;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * Guards of closed rows let the sync parent touch through with Syncable::GUARD_EXEMPTION
 * (sync_touch_only(OLD, NEW)): the touch flag alone never opens a row, only an UPDATE that
 * changes nothing but sync_txid passes. Tables are created inside the test transaction.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    Schema::create('sync_guard_probe', function (Blueprint $t): void {
        $t->uuid('id')->primary();
        $t->string('status', 16);
        $t->string('notes', 64)->nullable();
        $t->syncable();
    });
    Schema::create('sync_guard_probe_lines', function (Blueprint $t): void {
        $t->uuid('id')->primary();
        $t->uuid('document_id');
        $t->string('text', 64);
        $t->syncable(parent: 'sync_guard_probe', parentKey: ['document_id']);
    });

    $exemption = Syncable::GUARD_EXEMPTION;
    DB::unprepared(<<<SQL
        CREATE FUNCTION sync_guard_probe_guard() RETURNS trigger LANGUAGE plpgsql AS \$\$
        BEGIN
            {$exemption}
            IF OLD.status = 'draft' THEN
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END IF;
            RAISE EXCEPTION USING ERRCODE = 'KS999', MESSAGE = 'probe is closed';
        END;
        \$\$;
        CREATE TRIGGER sync_guard_probe_guard BEFORE UPDATE OR DELETE ON sync_guard_probe
            FOR EACH ROW EXECUTE FUNCTION sync_guard_probe_guard();
        SQL);

    $this->id = (string) Str::uuid7();
    DB::table('sync_guard_probe')->insert(['id' => $this->id, 'status' => 'posted', 'notes' => 'kept']);
});

it('lets the parent touch of a closed row through', function (): void {
    DB::table('sync_guard_probe_lines')->insert(['id' => (string) Str::uuid7(), 'document_id' => $this->id, 'text' => 'line']);

    expect(DB::table('sync_guard_probe')->where('id', $this->id)->value('notes'))->toBe('kept');
});

it('refuses a data change made with the touch flag on', function (): void {
    DB::statement("SELECT set_config('keystone.sync_touch', 'on', true)");

    expect(fn () => DB::table('sync_guard_probe')->where('id', $this->id)->update(['notes' => 'changed']))
        ->toThrow(QueryException::class, 'probe is closed');
});

it('refuses a delete made with the touch flag on', function (): void {
    DB::statement("SELECT set_config('keystone.sync_touch', 'on', true)");

    expect(fn () => DB::table('sync_guard_probe')->where('id', $this->id)->delete())
        ->toThrow(QueryException::class, 'probe is closed');
});

it('refuses a bare sync_txid update without the flag', function (): void {
    expect(fn () => DB::statement('UPDATE sync_guard_probe SET sync_txid = sync_txid WHERE id = ?', [$this->id]))
        ->toThrow(QueryException::class, 'probe is closed');
});

it('answers sync_touch_only only for a flagged update that changes nothing else', function (): void {
    // NEW as a copy of the stored row with one column replaced (columns: id, status, notes, sync_txid).
    $only = fn (string $new): bool => (bool) DB::selectOne(
        "SELECT sync_touch_only(p, {$new}) AS ok FROM sync_guard_probe p WHERE p.id = ?",
        [$this->id],
    )->ok;
    $touched = "ROW(p.id, p.status, p.notes, '6'::xid8)::sync_guard_probe";

    expect($only($touched))->toBeFalse();

    DB::statement("SELECT set_config('keystone.sync_touch', 'on', true)");

    expect($only($touched))->toBeTrue()
        ->and($only("ROW(p.id, p.status, 'changed', p.sync_txid)::sync_guard_probe"))->toBeFalse()
        ->and($only('NULL::sync_guard_probe'))->toBeFalse();
});

it('uses only the narrow exemption in every guard of the database', function (): void {
    $names = fn (string $like): array => collect(DB::select('SELECT proname FROM pg_proc WHERE prosrc LIKE ? ORDER BY proname', [$like]))
        ->pluck('proname')->all();

    // The flag itself is read by Core only; every guard asks sync_touch_only().
    expect(array_values(array_diff($names('%sync_touching()%'), ['sync_touch_only'])))->toBe([])
        ->and($names('%sync_touch_only(OLD, NEW)%'))->toContain('sales_deliveries_guard')
        ->and($names('%sync_touch_only(OLD, NEW)%'))->toContain('purchase_receipts_guard');
});

it('no longer recommends the unconditional exemption anywhere in the code', function (): void {
    $files = collect([...File::allFiles(app_path()), ...File::allFiles(database_path('migrations'))])
        ->filter(fn (SplFileInfo $f): bool => $f->getExtension() === 'php')
        ->filter(fn (SplFileInfo $f): bool => preg_match('/IF\s+sync_touching\(\)\s+THEN/i', (string) file_get_contents($f->getPathname())) === 1)
        ->map(fn (SplFileInfo $f): string => $f->getFilename())
        ->values()
        ->all();

    expect($files)->toBe([]);
});
