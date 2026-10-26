<?php

declare(strict_types=1);

use App\Modules\Identity\Services\PermissionCatalog;
use PHPUnit\Framework\Assert;

/**
 * @param  array<string, string>  $files  module dir name => php source returned by its permissions.php
 */
function permissionFixture(array $files): string
{
    $root = sys_get_temp_dir().'/keystone-perm-'.bin2hex(random_bytes(6));

    foreach ($files as $module => $source) {
        mkdir("{$root}/{$module}", 0777, true);
        file_put_contents("{$root}/{$module}/permissions.php", "<?php\nreturn {$source};\n");
    }

    return $root;
}

it('aggregates the permissions.php of every module under app/Modules', function (): void {
    $catalog = new PermissionCatalog(app_path('Modules'));
    $declared = collect(glob(app_path('Modules/*/permissions.php')))->map(fn (string $f): string => realpath($f))->sort()->values()->all();

    expect($catalog->files())->not->toBeEmpty()
        ->and(collect($catalog->files())->map(fn (string $f): string => realpath($f))->sort()->values()->all())->toBe($declared)
        ->and(array_keys($catalog->grouped()))->toContain('identity', 'organization', 'settings', 'files', 'notifications', 'workflow')
        ->and($catalog->all())->toContain('users.view', 'companies.delete', 'approvals.decide')
        ->and($catalog->superAdminOnly())->toBe(['companies.delete'])
        ->and($catalog->grantsFor('HR'))->toContain('users.create', 'departments.update', 'files.view')
        ->and($catalog->grantsFor('Sales'))->toContain('companies.view', 'branches.view', 'departments.view', 'files.view', 'files.create', 'notifications.view')
        ->and($catalog->grantsFor('Accountant'))->toContain('settings.view', 'users.view');

    // Grants per role are exactly what the module files declare for that role (or '*').
    foreach (['Accountant', 'Sales', 'Purchasing', 'Warehouse', 'HR', 'Viewer'] as $role) {
        $declared = [];
        foreach ($catalog->files() as $file) {
            foreach ((require $file)['permissions'] as $name => $options) {
                $roles = $options['roles'] ?? [];
                if (in_array($role, $roles, true) || in_array('*', $roles, true)) {
                    $declared[] = $name;
                }
            }
        }

        $grants = $catalog->grantsFor($role);
        expect($grants)->toEqualCanonicalizing($declared)
            // Invariants: no default role (other than Admin) gets super-admin-only or administrative permissions.
            ->and(array_intersect($grants, $catalog->superAdminOnly()))->toBe([])
            ->and(array_filter($grants, fn (string $p): bool => str_starts_with($p, 'roles.') || (str_starts_with($p, 'companies.') && $p !== 'companies.view')))->toBe([]);
    }

    // Viewer only reads; the one exception is what every role gets ('*', e.g. files.create for attachments).
    $everyRole = array_values(array_intersect(...array_map(
        fn (string $role): array => $catalog->grantsFor($role),
        ['Accountant', 'Sales', 'Purchasing', 'Warehouse', 'HR', 'Viewer'],
    )));
    $writes = array_filter(
        array_diff($catalog->grantsFor('Viewer'), $everyRole),
        fn (string $p): bool => preg_match('/\.(create|update|delete|manage|assign|decide|export|status|reset_password)$/', $p) === 1,
    );
    expect($writes)->toBe([])
        ->and($catalog->grantsFor('Viewer'))->toContain('notifications.view');
});

it('has no duplicate permission names across modules', function (): void {
    $seen = [];

    foreach ((new PermissionCatalog(app_path('Modules')))->files() as $file) {
        foreach (array_keys((require $file)['permissions']) as $name) {
            Assert::assertArrayNotHasKey($name, $seen, "Permission [{$name}] is declared in both [".($seen[$name] ?? '').'] and ['.$file.'].');
            $seen[$name] = $file;
        }
    }
});

it('fails with a clear message on a duplicate permission name', function (): void {
    $root = permissionFixture([
        'A' => "['group' => 'a', 'permissions' => ['things.view' => []]]",
        'B' => "['group' => 'b', 'permissions' => ['things.view' => []]]",
    ]);

    expect(fn () => (new PermissionCatalog($root))->all())->toThrow(InvalidArgumentException::class, 'Duplicate permission [things.view]');
});

it('fails on an unknown role name', function (): void {
    $root = permissionFixture(['A' => "['group' => 'a', 'permissions' => ['things.view' => ['roles' => ['Janitor']]]]"]);

    expect(fn () => (new PermissionCatalog($root))->all())->toThrow(InvalidArgumentException::class, 'Unknown role [Janitor] for permission [things.view]');
});

it('fails on a malformed file or permission name', function (): void {
    expect(fn () => (new PermissionCatalog(permissionFixture(['A' => "['permissions' => []]"])))->all())->toThrow(InvalidArgumentException::class)
        ->and(fn () => (new PermissionCatalog(permissionFixture(['A' => "['group' => 'a', 'permissions' => ['Bad' => []]]"])))->all())->toThrow(InvalidArgumentException::class, 'Invalid permission name');
});

it('expands wildcard roles and keeps the super-admin marker', function (): void {
    $root = permissionFixture(['A' => "['group' => 'a', 'permissions' => ['x.view' => ['roles' => ['*']], 'x.drop' => ['super_admin_only' => true], 'x.edit' => ['roles' => ['Sales']]]]"]);
    $catalog = new PermissionCatalog($root);

    expect($catalog->grantsFor('Viewer'))->toBe(['x.view'])
        ->and($catalog->grantsFor('Sales'))->toBe(['x.view', 'x.edit'])
        ->and($catalog->superAdminOnly())->toBe(['x.drop'])
        ->and($catalog->grouped())->toBe(['a' => ['x.view', 'x.drop', 'x.edit']]);
});

it('only checks permissions that exist in the catalog', function (): void {
    $all = app(PermissionCatalog::class)->all();
    $pattern = "/(?:->|::)(?:allows|allowed|allowedInActiveCompany|manages|can|cannot|authorize|hasPermissionTo)\([^;]*?'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'/";
    $used = [];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Modules'), FilesystemIterator::SKIP_DOTS));

    foreach ($iterator as $file) {
        if ($file->getExtension() !== 'php' || in_array($file->getFilename(), ['permissions.php', 'routes.php'], true)) {
            continue;
        }

        if (preg_match_all($pattern, (string) file_get_contents($file->getPathname()), $m) > 0) {
            foreach ($m[1] as $name) {
                $used[$name] = $file->getPathname();
            }
        }
    }

    expect($used)->not->toBeEmpty();

    foreach ($used as $name => $path) {
        Assert::assertContains($name, $all, "Permission [{$name}] checked in [{$path}] is missing from every permissions.php.");
    }
});
