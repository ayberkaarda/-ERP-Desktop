<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Company\CompanyContext;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Xid8;
use App\Models\User;
use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Organization\Models\Company;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpFoundation\Response;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\FixtureNoteSyncResource;
use Tests\Fixtures\Sync\SyncFixtures;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sync;
use Tests\TestCase;

/**
 * Shared set-up of the Sync module tests: fixture adapters (P1's fixture-notes plus the
 * windowed fixture-dated-notes), a test offline manifest naming them, the fixture policy,
 * users with exact permissions and desktop device headers.
 */
final class SyncKit
{
    public const array ALL = ['fixtures.view', 'fixtures.create', 'fixtures.update', 'fixtures.delete'];

    public static function boot(): void
    {
        // Every test permission exists before the first request caches the permission set.
        app(PermissionRegistry::class)->register('tests', [...self::ALL, 'fixtures.dated']);
        Identity::boot();
        SyncFixtures::install();
        DatedNote::install();
        SharedRate::install();
        ScriptedNoteWriter::reset();

        app()->bind(FixtureNoteSyncResource::class);
        app()->bind(DatedNoteSyncResource::class);
        app()->bind(ScriptedNoteWriter::class);
        app()->bind('sync.test.rates', static fn (): ScopedSyncResource => ScopedSyncResource::rates());
        app()->bind('sync.test.tags', static fn (): ScopedSyncResource => ScopedSyncResource::tags());
        app()->tag([FixtureNoteSyncResource::class, DatedNoteSyncResource::class, 'sync.test.rates', 'sync.test.tags'], SyncResource::TAG);
        app()->tag([ScriptedNoteWriter::class], SyncWriter::TAG);
        Gate::policy(FixtureNote::class, FixtureNotePolicy::class);

        self::manifest();
    }

    /**
     * Writes the test manifest (optionally changed) and points config sync.manifest_path at it.
     *
     * @param  (Closure(array<string, mixed>): array<string, mixed>)|null  $change
     * @return array<string, mixed>
     */
    public static function manifest(?Closure $change = null): array
    {
        $manifest = self::baseManifest();

        if ($change !== null) {
            $manifest = $change($manifest);
        }

        $json = json_encode($manifest, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'keystone-sync-manifest-'.md5($json).'.json';
        file_put_contents($path, $json);
        config(['sync.manifest_path' => $path]);

        return $manifest;
    }

    /**
     * @return array<string, mixed>
     */
    public static function baseManifest(): array
    {
        $ops = [
            ['op' => 'create', 'route' => 'POST /api/v1/fixture-notes', 'requires' => ['all_of' => ['fixtures.create']], 'version_check' => 'none'],
            ['op' => 'update', 'route' => 'PATCH /api/v1/fixture-notes/{id}', 'requires' => ['all_of' => ['fixtures.update']], 'version_check' => 'field-merge'],
            ['op' => 'delete', 'route' => 'DELETE /api/v1/fixture-notes/{id}', 'requires' => ['all_of' => ['fixtures.delete']], 'version_check' => 'exact'],
            ['op' => 'action', 'action' => 'close', 'route' => 'POST /api/v1/fixture-notes/{id}/close', 'requires' => ['all_of' => ['fixtures.update']], 'version_check' => 'exact'],
        ];

        return [
            'manifest_version' => 7,
            'sync_schema_version' => 1,
            'api_prefix' => '/api/v1',
            'defaults' => ['recent_window_days' => 30, 'snapshot_refresh_minutes' => 15],
            'resources' => [
                [
                    'resource' => 'fixture-notes',
                    'module' => 'Tests',
                    'scope' => 'company',
                    'path' => '/api/v1/fixture-notes',
                    'detail_path' => '/api/v1/fixture-notes/{id}',
                    'api_resource' => 'App\\Tests\\FixtureNoteResource',
                    'requires' => ['all_of' => ['fixtures.view']],
                    'read' => 'local-first',
                    'source' => 'pull',
                    'embeds' => ['lines'],
                    'write' => [
                        'mode' => 'draft-outbox',
                        'ops' => $ops,
                        'derived_fields' => [],
                        'draft_only' => ['field' => 'status', 'value' => 'draft'],
                        'conflict' => 'field-merge',
                    ],
                ],
                [
                    'resource' => 'fixture-dated-notes',
                    'module' => 'Tests',
                    'scope' => 'company',
                    'path' => '/api/v1/fixture-dated-notes',
                    'detail_path' => '/api/v1/fixture-dated-notes/{id}',
                    'api_resource' => 'App\\Tests\\DatedNoteResource',
                    'requires' => ['any_of' => ['fixtures.view', 'fixtures.dated']],
                    'read' => 'online-first',
                    'source' => 'pull',
                    'window_days' => 30,
                    'window_field' => 'note_date',
                ],
                [
                    'resource' => 'fixture-rates',
                    'module' => 'Tests',
                    'scope' => 'company_or_global',
                    'path' => '/api/v1/fixture-rates',
                    'detail_path' => '/api/v1/fixture-rates/{id}',
                    'api_resource' => 'App\Tests\PlainResource',
                    'requires' => ['all_of' => ['fixtures.view']],
                    'read' => 'local-first',
                    'source' => 'pull',
                ],
                [
                    'resource' => 'fixture-tags',
                    'module' => 'Tests',
                    'scope' => 'global_with_company_activation',
                    'activation' => ['table' => 'sync_fixture_tag_activations', 'key' => 'tag_id'],
                    'path' => '/api/v1/fixture-tags',
                    'detail_path' => '/api/v1/fixture-tags/{id}',
                    'api_resource' => 'App\Tests\PlainResource',
                    'requires' => ['all_of' => ['fixtures.view']],
                    'read' => 'local-first',
                    'source' => 'pull',
                ],
                [
                    'resource' => 'fixture-balances',
                    'module' => 'Tests',
                    'scope' => 'company',
                    'path' => '/api/v1/fixture-balances',
                    'requires' => ['all_of' => ['fixtures.view']],
                    'read' => 'offline-fallback',
                    'source' => 'snapshot',
                ],
                [
                    'resource' => 'fixture-unadapted',
                    'module' => 'Tests',
                    'scope' => 'company',
                    'path' => '/api/v1/fixture-unadapted',
                    'detail_path' => '/api/v1/fixture-unadapted/{id}',
                    'api_resource' => 'App\\Tests\\UnadaptedResource',
                    'requires' => ['all_of' => ['fixtures.view']],
                    'read' => 'local-first',
                    'source' => 'pull',
                ],
            ],
            'online_only' => [
                ['action' => 'closeFixtureNote', 'i18n_key' => 'desktop.onlineOnly.closeFixtureNote', 'category' => 'finalize', 'routes' => ['POST /api/v1/fixture-notes/{id}/finalize']],
                ['action' => 'serverCalculation', 'i18n_key' => 'desktop.onlineOnly.serverCalculation', 'category' => 'server-calculation', 'routes' => ['GET /api/v1/pricing/resolve']],
            ],
        ];
    }

    /**
     * A company and a user holding exactly $permissions in it.
     *
     * @param  list<string>  $permissions
     * @return array{0: Company, 1: User}
     */
    public static function actor(array $permissions = self::ALL): array
    {
        Identity::fresh();
        $companyId = Actors::company();
        $user = Actors::user($permissions);
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return [Company::query()->findOrFail($companyId), $user];
    }

    /**
     * @return array<string, string>
     */
    public static function headers(User $user, Company $company): array
    {
        return Sync::deviceHeaders($user, $company);
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, string>  $headers
     * @return TestResponse<Response>
     */
    public static function post(TestCase $test, string $endpoint, array $body, array $headers): TestResponse
    {
        Identity::fresh();

        return $test->withHeaders($headers)->postJson("/api/v1/sync/{$endpoint}", $body);
    }

    /**
     * @param  array<string, string>  $headers
     * @return TestResponse<Response>
     */
    public static function manifestOf(TestCase $test, array $headers): TestResponse
    {
        Identity::fresh();

        return $test->withHeaders($headers)->getJson('/api/v1/sync/manifest');
    }

    /**
     * @param  list<array<string, mixed>>  $resources
     * @param  array<string, string>  $headers
     * @return TestResponse<Response>
     */
    public static function pull(TestCase $test, array $resources, array $headers): TestResponse
    {
        return self::post($test, 'pull', ['schema_version' => 1, 'resources' => $resources], $headers);
    }

    /**
     * @param  list<array<string, mixed>>  $mutations
     * @param  array<string, string>  $headers
     * @return TestResponse<Response>
     */
    public static function push(TestCase $test, array $mutations, array $headers): TestResponse
    {
        return self::post($test, 'push', ['schema_version' => 1, 'mutations' => $mutations], $headers);
    }

    /**
     * Response body validated against the contract schema, returned decoded.
     *
     * @param  TestResponse<Response>  $response
     * @return array<string, mixed>
     */
    public static function wire(TestResponse $response, string $schema): array
    {
        $content = (string) $response->getContent();
        WireSchema::assertValid($schema, json_decode($content, false, 512, JSON_THROW_ON_ERROR));

        /** @var array<string, mixed> */
        return json_decode($content, true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * A push mutation with protocol defaults for the op.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    public static function mutation(string $op, string $id, array $payload = [], ?int $base = null, array $overrides = []): array
    {
        return [
            'idempotency_key' => (string) Str::uuid7(),
            'op' => $op,
            'resource' => 'fixture-notes',
            'id' => $id,
            'base_version' => $op === 'create' ? null : $base,
            'changed_fields' => in_array($op, ['update', 'action'], true) ? array_keys($payload) : [],
            'occurred_at' => '2026-10-25T18:00:30+03:00',
            'payload' => $payload === [] ? new \stdClass : $payload,
            ...$overrides,
        ];
    }

    /**
     * Committed fixture note of the company (version 1, draft), optionally with lines.
     *
     * @param  array<string, mixed>  $attributes
     * @param  list<string>  $lines
     */
    public static function note(Company $company, array $attributes = [], array $lines = []): FixtureNote
    {
        return app(CompanyContext::class)->runAs($company->id, static function () use ($attributes, $lines): FixtureNote {
            $note = FixtureNote::query()->create(['title' => 'Note', ...$attributes]);

            foreach ($lines as $i => $body) {
                $note->lines()->create(['position' => $i + 1, 'body' => $body]);
            }

            return $note->refresh();
        });
    }

    /**
     * Applies $fn to the note as a web user would (a committed server change).
     *
     * @param  Closure(FixtureNote): void  $fn
     */
    public static function serverEdit(Company $company, FixtureNote $note, Closure $fn): FixtureNote
    {
        return app(CompanyContext::class)->runAs($company->id, static function () use ($note, $fn): FixtureNote {
            $fresh = FixtureNote::query()->findOrFail($note->id);
            $fn($fresh);

            return $fresh->refresh();
        });
    }

    /**
     * Activity log entry for a server-side version step, as activitylog writes it for models
     * whose logOnly includes version (the fixture note itself does not log).
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function logChange(Company $company, FixtureNote $note, array $attributes): void
    {
        DB::table('activity_log')->insert([
            'id' => (string) Str::uuid7(),
            'company_id' => $company->id,
            'log_name' => 'audit',
            'description' => 'updated',
            'subject_type' => $note->getMorphClass(),
            'subject_id' => $note->id,
            'event' => 'updated',
            'attribute_changes' => json_encode(['attributes' => $attributes, 'old' => []], JSON_THROW_ON_ERROR),
            'properties' => '{}',
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ]);
    }

    /**
     * Waits until a pull can see everything committed so far.
     */
    public static function settle(): Xid8
    {
        return DB::transaction(static fn (): Xid8 => Sync::currentTxid());
    }

    public static function waitVisible(): void
    {
        Sync::awaitHorizonPast(self::settle());
    }
}
