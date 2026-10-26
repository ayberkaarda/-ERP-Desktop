<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Syncable fixture tables and the `fixture-notes` adapters, so the Sync module can be tested
 * without any business module adapter.
 *
 * - sync_fixture_notes: company scoped, versioned, soft deletes; tracked (`syncable()`).
 * - sync_fixture_note_lines: child rows; `syncable(parent: ...)` moves the note's position.
 * - sync_fixture_tags: global (no company_id), hard deletes only.
 *
 * Tables are created once per database and kept (migrate:fresh drops them); tests that commit
 * use the SyncDatabase trait, which truncates them with the rest.
 */
final class SyncFixtures
{
    public const array TABLES = ['sync_fixture_note_lines', 'sync_fixture_notes', 'sync_fixture_tags'];

    public static function install(): void
    {
        if (! Schema::hasTable('sync_fixture_notes')) {
            Schema::create('sync_fixture_notes', function (Blueprint $table): void {
                $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
                $table->uuid('company_id')->index();
                $table->string('title', 100);
                $table->string('status', 16)->default('draft');
                $table->unsignedInteger('version');
                $table->timestampsTz();
                $table->softDeletesTz();
                $table->syncable();
            });
        }

        if (! Schema::hasTable('sync_fixture_note_lines')) {
            Schema::create('sync_fixture_note_lines', function (Blueprint $table): void {
                $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
                $table->foreignUuid('note_id')->constrained('sync_fixture_notes')->cascadeOnDelete();
                $table->unsignedInteger('position');
                $table->string('body', 200);
                $table->syncable(parent: 'sync_fixture_notes', parentKey: ['note_id']);
            });
        }

        if (! Schema::hasTable('sync_fixture_tags')) {
            Schema::create('sync_fixture_tags', function (Blueprint $table): void {
                $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
                $table->string('name', 50);
                $table->syncable();
            });
        }
    }

    /**
     * Tags the fixture adapters the way a module service provider tags its own.
     */
    public static function register(Application $app): void
    {
        $app->bind(FixtureNoteSyncResource::class);
        $app->bind(FixtureNoteSyncWriter::class);
        $app->tag([FixtureNoteSyncResource::class], SyncResource::TAG);
        $app->tag([FixtureNoteSyncWriter::class], SyncWriter::TAG);
    }

    public static function drop(): void
    {
        foreach (self::TABLES as $table) {
            Schema::dropIfExists($table);
        }

        DB::table('sync_tombstones')->whereIn('resource_table', self::TABLES)->delete();
    }
}
