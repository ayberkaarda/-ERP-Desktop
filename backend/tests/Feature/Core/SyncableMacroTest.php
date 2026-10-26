<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Sync\Schema\Syncable;
use App\Core\Sync\Xid8;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Fixtures\Sync\SyncFixtures;
use Tests\Support\Sync;

/*
 * Committed writes (SyncDatabase), so sync_txid values are real transaction ids and the pull
 * horizon can move past them.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncFixtures::install();
    $this->company = (string) Str::uuid7();
    app(CompanyContext::class)->set($this->company);
});

/**
 * Runs $fn in its own committed transaction and returns that transaction's xid8.
 */
function inTransaction(Closure $fn): Xid8
{
    return DB::transaction(function () use ($fn): Xid8 {
        $fn();

        return Sync::currentTxid();
    });
}

function note(string $title = 'Note'): FixtureNote
{
    return FixtureNote::query()->create(['title' => $title]);
}

it('stamps inserts with the inserting transaction', function (): void {
    $note = null;
    $txid = inTransaction(function () use (&$note): void {
        $note = note();
    });

    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($txid);
});

it('restamps every update without touching version semantics', function (): void {
    $note = note();
    $before = Sync::txidOf('sync_fixture_notes', $note->id);

    $txid = inTransaction(function () use ($note): void {
        $note->update(['title' => 'Renamed']);
    });

    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($txid)
        ->and($txid->greaterThan($before))->toBeTrue()
        ->and($note->fresh()?->version)->toBe(2);
});

it('writes a tombstone on soft delete', function (): void {
    $note = note();

    $txid = inTransaction(function () use ($note): void {
        $note->delete();
    });

    $tomb = Sync::tombstone('sync_fixture_notes', $note->id);

    expect($tomb)->not->toBeNull()
        ->and($tomb->reason)->toBe('soft_deleted')
        ->and($tomb->company_id)->toBe($this->company)
        ->and($tomb->parent_id)->toBeNull()
        ->and(Xid8::of($tomb->sync_txid))->toEqual($txid)
        ->and($tomb->deleted_at)->not->toBeNull();
});

it('removes the tombstone on restore and moves the row forward', function (): void {
    $note = note();
    $note->delete();
    $deletedAt = Sync::txidOf('sync_fixture_notes', $note->id);

    $txid = inTransaction(function () use ($note): void {
        $note->restore();
    });

    expect(Sync::tombstone('sync_fixture_notes', $note->id))->toBeNull()
        ->and(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($txid)
        ->and($txid->greaterThan($deletedAt))->toBeTrue();
});

it('writes a tombstone on hard delete, upserting the soft delete one', function (): void {
    $note = note();
    $note->delete();
    $soft = Sync::tombstone('sync_fixture_notes', $note->id);

    $txid = inTransaction(function () use ($note): void {
        $note->forceDelete();
    });

    $tomb = Sync::tombstone('sync_fixture_notes', $note->id);

    expect($tomb?->reason)->toBe('deleted')
        ->and(Xid8::of((string) $tomb?->sync_txid))->toEqual($txid)
        ->and(Xid8::of((string) $tomb?->sync_txid)->greaterThan(Xid8::of((string) $soft?->sync_txid)))->toBeTrue()
        ->and(DB::table('sync_tombstones')->where('row_id', $note->id)->count())->toBe(1);
});

it('lets child statements touch their parent, not its version or updated_at', function (): void {
    $note = note();
    $other = note('Other');
    $loaded = DB::table('sync_fixture_notes')->where('id', $note->id)->first(['version', 'updated_at']);
    $otherBefore = Sync::txidOf('sync_fixture_notes', $other->id);

    $inserted = inTransaction(function () use ($note): void {
        DB::table('sync_fixture_note_lines')->insert([
            ['note_id' => $note->id, 'position' => 1, 'body' => 'a'],
            ['note_id' => $note->id, 'position' => 2, 'body' => 'b'],
        ]);
    });
    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($inserted);

    $updated = inTransaction(fn () => DB::table('sync_fixture_note_lines')->where('note_id', $note->id)->update(['body' => 'c']));
    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($updated);

    $deleted = inTransaction(fn () => DB::table('sync_fixture_note_lines')->where('note_id', $note->id)->delete());
    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($deleted)
        ->and(DB::table('sync_fixture_notes')->where('id', $note->id)->first(['version', 'updated_at']))->toEqual($loaded)
        ->and(Sync::txidOf('sync_fixture_notes', $other->id))->toEqual($otherBefore);
});

it('touches the old and the new parent when a child moves', function (): void {
    $from = note('From');
    $to = note('To');
    $line = DB::table('sync_fixture_note_lines')->insertGetId(['note_id' => $from->id, 'position' => 1, 'body' => 'x']);

    $txid = inTransaction(fn () => DB::table('sync_fixture_note_lines')->where('id', $line)->update(['note_id' => $to->id]));

    expect(Sync::txidOf('sync_fixture_notes', $from->id))->toEqual($txid)
        ->and(Sync::txidOf('sync_fixture_notes', $to->id))->toEqual($txid);
});

it('uses the top-level transaction id inside savepoints', function (): void {
    $note = null;
    $outer = DB::transaction(function () use (&$note): Xid8 {
        $outer = Sync::currentTxid();
        DB::transaction(function () use (&$note): void {
            $note = note();
        });

        return $outer;
    });

    expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($outer);
});

it('shows committed rows to the horizon but never rows of a still open transaction', function (): void {
    $committed = note('Committed');
    Sync::awaitHorizonPast(Sync::txidOf('sync_fixture_notes', $committed->id));

    expect(Sync::belowHorizon('sync_fixture_notes'))->toContain($committed->id);

    // What RefreshDatabase would do: the test's writes stay inside one open transaction.
    DB::beginTransaction();

    try {
        $open = note('Open');

        $openTxid = Sync::txidOf('sync_fixture_notes', $open->id);

        expect(Sync::belowHorizon('sync_fixture_notes'))->not->toContain($open->id)
            ->and($openTxid->lessThan(Sync::horizon()))->toBeFalse()
            // However long it waits: the horizon cannot pass the transaction asking for it.
            ->and(fn () => Sync::awaitHorizonPast($openTxid, 1.0))->toThrow(RuntimeException::class);
    } finally {
        DB::rollBack();
    }
});

it('indexes the sync position by company, or globally without company_id', function (): void {
    $index = static fn (string $table): string => (string) DB::table('pg_indexes')
        ->where('tablename', $table)
        ->where('indexname', "{$table}_sync_position_index")
        ->value('indexdef');

    expect($index('sync_fixture_notes'))->toContain('(company_id, sync_txid, id)')
        ->and($index('sync_fixture_tags'))->toContain('(sync_txid, id)')
        ->and($index('sync_fixture_tags'))->not->toContain('company_id');

    $id = (string) Str::uuid7();
    DB::table('sync_fixture_tags')->insert(['id' => $id, 'name' => 't']);
    DB::table('sync_fixture_tags')->where('id', $id)->delete();

    expect(Sync::tombstone('sync_fixture_tags', $id)?->company_id)->toBeNull()
        ->and(Sync::tombstone('sync_fixture_tags', $id)?->reason)->toBe('deleted');
});

it('tracks a child resource on its own, with the parent id in its tombstones', function (): void {
    Schema::create('sync_fixture_variants', function (Blueprint $table): void {
        $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $table->uuid('company_id');
        $table->foreignUuid('note_id')->constrained('sync_fixture_notes')->cascadeOnDelete();
        $table->string('code', 20);
        $table->syncable(parent: 'sync_fixture_notes', parentKey: ['note_id'], tracked: true);
    });

    try {
        $note = note();
        $id = (string) Str::uuid7();

        $txid = inTransaction(fn () => DB::table('sync_fixture_variants')->insert([
            'id' => $id, 'company_id' => $this->company, 'note_id' => $note->id, 'code' => 'V1',
        ]));
        expect(Sync::txidOf('sync_fixture_variants', $id))->toEqual($txid)
            ->and(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($txid);

        DB::table('sync_fixture_variants')->where('id', $id)->delete();

        expect(Sync::tombstone('sync_fixture_variants', $id)?->parent_id)->toBe($note->id)
            ->and(Sync::tombstone('sync_fixture_variants', $id)?->company_id)->toBe($this->company);
    } finally {
        Schema::dropIfExists('sync_fixture_variants');
        DB::table('sync_tombstones')->where('resource_table', 'sync_fixture_variants')->delete();
    }
});

it('removes column, index and triggers with dropSyncable', function (): void {
    Schema::create('sync_fixture_scratch', function (Blueprint $table): void {
        $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $table->uuid('company_id');
        $table->softDeletesTz();
        $table->syncable();
    });

    try {
        $triggers = static fn (): int => (int) DB::table('pg_trigger')
            ->join('pg_class', 'pg_class.oid', '=', 'pg_trigger.tgrelid')
            ->where('pg_class.relname', 'sync_fixture_scratch')
            ->where('pg_trigger.tgisinternal', false)
            ->count();

        expect($triggers())->toBe(3)
            ->and(Schema::hasColumn('sync_fixture_scratch', 'sync_txid'))->toBeTrue();

        Schema::table('sync_fixture_scratch', fn (Blueprint $table) => $table->dropSyncable());

        expect($triggers())->toBe(0)
            ->and(Schema::hasColumn('sync_fixture_scratch', 'sync_txid'))->toBeFalse()
            ->and(Schema::hasIndex('sync_fixture_scratch', 'sync_fixture_scratch_sync_position_index'))->toBeFalse();
    } finally {
        Schema::dropIfExists('sync_fixture_scratch');
    }
});

it('adds sync tracking to an existing table with rows', function (): void {
    Schema::create('sync_fixture_legacy', function (Blueprint $table): void {
        $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $table->uuid('company_id');
    });

    try {
        DB::table('sync_fixture_legacy')->insert(['company_id' => $this->company]);

        $txid = inTransaction(fn () => Schema::table('sync_fixture_legacy', fn (Blueprint $table) => $table->syncable()));
        $row = DB::table('sync_fixture_legacy')->selectRaw('sync_txid::text AS v')->first();

        expect(Xid8::of((string) $row?->v))->toEqual($txid)
            ->and((string) DB::table('pg_indexes')->where('indexname', 'sync_fixture_legacy_sync_position_index')->value('indexdef'))
            ->toContain('(company_id, sync_txid, id)');
    } finally {
        Schema::dropIfExists('sync_fixture_legacy');
    }
});

it('leaves no position change or tombstone behind a rolled back savepoint', function (): void {
    $note = note();
    $before = Sync::txidOf('sync_fixture_notes', $note->id);
    $ghost = null;

    DB::transaction(function () use ($note, &$ghost): void {
        try {
            DB::transaction(function () use ($note, &$ghost): void {
                $ghost = note('Ghost');
                $note->delete();
                DB::table('sync_fixture_note_lines')->insert(['note_id' => $note->id, 'position' => 1, 'body' => 'x']);

                throw new RuntimeException('roll back the savepoint');
            });
        } catch (RuntimeException) {
            // the outer transaction goes on and commits
        }
    });

    expect(Sync::tombstone('sync_fixture_notes', $note->id))->toBeNull()
        ->and(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($before)
        ->and(DB::table('sync_fixture_notes')->where('id', $ghost?->id)->exists())->toBeFalse()
        ->and(DB::table('sync_fixture_note_lines')->where('note_id', $note->id)->exists())->toBeFalse();
});

it('runs a syncable/dropSyncable cycle on a 63 character table name', function (): void {
    $name = str_pad('sync_fixture_long_', 63, 'x');

    Schema::create($name, function (Blueprint $table): void {
        $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
        $table->uuid('company_id');
        $table->syncable();
    });

    try {
        $index = Syncable::indexName($name);

        expect(strlen($index))->toBeLessThanOrEqual(63)
            ->and(Schema::hasIndex($name, $index))->toBeTrue();

        Schema::table($name, fn (Blueprint $table) => $table->dropSyncable());
        expect(Schema::hasColumn($name, 'sync_txid'))->toBeFalse()
            ->and(Schema::hasIndex($name, $index))->toBeFalse();

        Schema::table($name, fn (Blueprint $table) => $table->syncable());
        expect(Schema::hasIndex($name, $index))->toBeTrue();
    } finally {
        Schema::dropIfExists($name);
    }
});

it('stamps after the table guards and lets them pass parent touches', function (): void {
    // A guard in the style of the posted-document guards: closed notes are frozen.
    DB::unprepared(<<<'SQL'
        CREATE OR REPLACE FUNCTION sync_fixture_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF sync_touching() THEN RETURN NEW; END IF;
            IF OLD.status = 'closed' THEN
                RAISE EXCEPTION 'closed notes are immutable' USING ERRCODE = '23514';
            END IF;
            IF (to_jsonb(NEW) - ARRAY['title', 'status', 'version', 'updated_at']) IS DISTINCT FROM
               (to_jsonb(OLD) - ARRAY['title', 'status', 'version', 'updated_at']) THEN
                RAISE EXCEPTION 'only title and status may change' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER sync_fixture_notes_guard BEFORE UPDATE ON sync_fixture_notes
            FOR EACH ROW EXECUTE FUNCTION sync_fixture_closed_guard();
        SQL);

    try {
        $note = note();
        $order = DB::table('pg_trigger')
            ->join('pg_class', 'pg_class.oid', '=', 'pg_trigger.tgrelid')
            ->where('pg_class.relname', 'sync_fixture_notes')
            ->whereIn('tgname', ['sync_fixture_notes_guard', 'zz_sync_touch'])
            ->orderBy('tgname')
            ->pluck('tgname')
            ->all();

        // Name order is firing order: the guard compares before sync_txid is restamped.
        expect($order)->toBe(['sync_fixture_notes_guard', 'zz_sync_touch']);

        $txid = inTransaction(fn () => $note->update(['title' => 'Allowed', 'status' => 'closed']));
        expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($txid);

        // A line change on the closed note still moves its position, through sync_touching().
        $lineTx = inTransaction(fn () => DB::table('sync_fixture_note_lines')->insert(['note_id' => $note->id, 'position' => 1, 'body' => 'late']));
        expect(Sync::txidOf('sync_fixture_notes', $note->id))->toEqual($lineTx)
            ->and(DB::selectOne('SELECT sync_touching() AS t')->t)->toBeFalse();

        // Everything else on the closed note is still refused.
        expect(fn () => $note->fresh()?->update(['title' => 'Nope']))->toThrow(QueryException::class);
    } finally {
        DB::unprepared('DROP TRIGGER IF EXISTS sync_fixture_notes_guard ON sync_fixture_notes; DROP FUNCTION IF EXISTS sync_fixture_closed_guard();');
    }
});
