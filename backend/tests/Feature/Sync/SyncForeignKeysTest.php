<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Companies;

/*
 * Rows of the Sync tables go with their user and company (2027_08_01_400400, 400500): no orphan
 * generations, resolutions or full-download sessions pile up after a physical delete.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Companies::make();
    $this->user = User::factory()->create();
});

function syncRows(object $test): void
{
    DB::table('sync_visibility_generations')->insert([
        'user_id' => $test->user->id, 'company_id' => $test->company, 'resource' => 'parties',
        'generation' => 0, 'state' => 'visible', 'updated_at' => now(),
    ]);
    DB::table('sync_push_resolutions')->insert([
        'resolved_scope_hash' => hash('sha256', (string) Str::uuid7()), 'resolved_key' => (string) Str::uuid7(),
        'superseded_by' => (string) Str::uuid7(), 'user_id' => $test->user->id, 'company_id' => $test->company, 'created_at' => now(),
    ]);
}

/**
 * @return array<string, int>
 */
function syncRowCounts(): array
{
    return [
        'sync_visibility_generations' => DB::table('sync_visibility_generations')->count(),
        'sync_push_resolutions' => DB::table('sync_push_resolutions')->count(),
    ];
}

it('declares cascading user and company keys on every per-user sync table', function (): void {
    $keys = collect(DB::select(<<<'SQL'
        SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref, c.confdeltype AS on_delete
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid::regclass::text IN ('sync_visibility_generations', 'sync_push_resolutions', 'sync_full_downloads')
        SQL))->map(fn (object $k): string => "{$k->tbl}->{$k->ref}:{$k->on_delete}")->sort()->values()->all();

    expect($keys)->toBe([
        'sync_full_downloads->companies:c',
        'sync_full_downloads->user_devices:c',
        'sync_full_downloads->users:c',
        'sync_push_resolutions->companies:c',
        'sync_push_resolutions->users:c',
        'sync_visibility_generations->companies:c',
        'sync_visibility_generations->users:c',
    ]);
});

it('removes the rows of a deleted user', function (): void {
    syncRows($this);

    DB::table('users')->where('id', $this->user->id)->delete();

    expect(syncRowCounts())->toBe(['sync_visibility_generations' => 0, 'sync_push_resolutions' => 0]);
});

it('removes the rows of a deleted company', function (): void {
    syncRows($this);

    Companies::remove($this->company);

    expect(syncRowCounts())->toBe(['sync_visibility_generations' => 0, 'sync_push_resolutions' => 0]);
});

it('refuses rows for an unknown user or company', function (): void {
    expect(fn () => DB::table('sync_visibility_generations')->insert([
        'user_id' => (string) Str::uuid7(), 'company_id' => $this->company, 'resource' => 'parties',
        'generation' => 0, 'state' => 'visible', 'updated_at' => now(),
    ]))->toThrow(QueryException::class);
});
