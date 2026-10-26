<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\RoleAdministration;
use App\Modules\Identity\Services\UserAdministration;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;

/*
 * Visibility generations move with the access change itself (Identity AccessChanged, in the
 * transaction of the change), not only when a later manifest or pull observes the new state:
 * an access lost and regained between two syncs still resets every cursor issued before.
 * Committed writes (SyncDatabase), as pull only reads below the horizon.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view', 'fixtures.create']);
    $this->headers = SyncKit::headers($this->user, $this->company);
    $this->admin = Actors::user([], $this->company->id, ['is_super_admin' => true]);
    $this->role = app(CompanyContext::class)->runAs($this->company->id, fn (): Role => Role::query()
        ->whereIn('id', DB::table('model_has_roles')->where('model_id', $this->user->id)->pluck('role_id'))->firstOrFail());

    SyncKit::note($this->company, ['title' => 'Visible']);
    SyncKit::waitVisible();
    $this->cursor = visibilityPull($this, null)['next_cursor'];
});

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function visibilityPull(object $test, ?array $cursor): array
{
    $response = SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $test->headers)->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

function asCompany(object $test, Closure $fn): mixed
{
    return app(CompanyContext::class)->runAs($test->company->id, $fn);
}

function generationOf(object $test): ?int
{
    $value = DB::table('sync_visibility_generations')
        ->where('user_id', $test->user->id)->where('company_id', $test->company->id)->where('resource', 'fixture-notes')
        ->value('generation');

    return $value === null ? null : (int) $value;
}

it('resets the cursor when a role loses and regains the permission between two syncs', function (): void {
    asCompany($this, function (): void {
        app(RoleAdministration::class)->update($this->admin, $this->role, ['permissions' => ['fixtures.create']]);
        app(RoleAdministration::class)->update($this->admin, $this->role->refresh(), ['permissions' => ['fixtures.view', 'fixtures.create']]);
    });

    $page = visibilityPull($this, $this->cursor);

    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed')
        ->and(array_column($page['rows'], 'title'))->toBe(['Visible'])
        ->and($page['next_cursor']['gen'])->toBe(2);
});

it('resets the cursor when the user changes roles away and back between two syncs', function (): void {
    $other = asCompany($this, function (): Role {
        $role = new Role(['name' => 'Writer only', 'guard_name' => 'web']);
        $role->save();
        $role->givePermissionTo('fixtures.create');

        return $role;
    });

    asCompany($this, function () use ($other): void {
        app(UserAdministration::class)->syncRoles($this->admin, $this->user, $this->company->id, [$other->id]);
        app(UserAdministration::class)->syncRoles($this->admin, $this->user, $this->company->id, [$this->role->id]);
    });

    $page = visibilityPull($this, $this->cursor);

    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed');
});

it('resets the cursor when the role is deleted and the permission comes back through another role', function (): void {
    asCompany($this, function (): void {
        app(RoleAdministration::class)->delete($this->role);
        $again = app(RoleAdministration::class)->create($this->admin, ['name' => 'Readers again', 'permissions' => ['fixtures.view', 'fixtures.create']]);
        app(UserAdministration::class)->syncRoles($this->admin, $this->user, $this->company->id, [$again->id]);
    });

    expect(visibilityPull($this, $this->cursor)['reset_reason'])->toBe('visibility_changed');
});

it('raises the generation inside the transaction of the change and drops it on rollback', function (): void {
    $before = generationOf($this);
    $inside = null;

    try {
        DB::transaction(function () use (&$inside): void {
            asCompany($this, fn () => app(RoleAdministration::class)->update($this->admin, $this->role, ['permissions' => ['fixtures.create']]));
            $inside = generationOf($this);

            throw new LogicException('rolled back');
        });
    } catch (LogicException) {
    }

    expect($before)->toBe(0)
        ->and($inside)->toBe(1)
        ->and(generationOf($this))->toBe($before)
        ->and(visibilityPull($this, $this->cursor)['reset'])->toBeFalse();
});

it('keeps the generation when a change leaves the resource visible', function (): void {
    asCompany($this, fn () => app(RoleAdministration::class)->update($this->admin, $this->role, ['permissions' => ['fixtures.view', 'fixtures.create', 'fixtures.update']]));

    expect(generationOf($this))->toBe(0)
        ->and(visibilityPull($this, $this->cursor)['reset'])->toBeFalse();
});

it('touches no generation of a user who never synced', function (): void {
    $fresh = Actors::user(['fixtures.view'], $this->company->id);

    asCompany($this, fn () => app(UserAdministration::class)->syncRoles($this->admin, $fresh, $this->company->id, [$this->role->id]));

    expect(DB::table('sync_visibility_generations')->where('user_id', $fresh->id)->count())->toBe(0);
});

it('resets the cursors of a super admin flag change', function (): void {
    app(UserAdministration::class)->update($this->admin, User::query()->findOrFail($this->user->id), ['is_super_admin' => true]);
    asCompany($this, fn () => app(RoleAdministration::class)->update($this->admin, $this->role, ['permissions' => ['fixtures.create']]));
    app(UserAdministration::class)->update($this->admin, User::query()->findOrFail($this->user->id), ['is_super_admin' => false]);
    asCompany($this, fn () => app(RoleAdministration::class)->update($this->admin, $this->role, ['permissions' => ['fixtures.view', 'fixtures.create']]));

    expect(visibilityPull($this, $this->cursor)['reset_reason'])->toBe('visibility_changed');
});
