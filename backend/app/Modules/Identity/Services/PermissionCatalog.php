<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Identity\Models\Permission;
use Illuminate\Support\Carbon;
use InvalidArgumentException;
use Spatie\Permission\PermissionRegistrar;

/**
 * The permission catalog grouped by module. Every module declares its own permissions in
 * app/Modules/<Name>/permissions.php (see the docblock of those files); they are discovered the same
 * way ModuleLoader discovers providers. Permissions registered at runtime are merged on top.
 */
final class PermissionCatalog implements PermissionRegistry
{
    public const string GUARD = 'web';

    /** Role names a module file may grant to; Admin always gets the whole catalog on its own. */
    public const array DEFAULT_ROLES = ['Admin', 'Accountant', 'Sales', 'Purchasing', 'Warehouse', 'HR', 'Viewer'];

    /** @var array<string, list<string>>|null */
    private ?array $modules = null;

    /** @var array<string, list<string>> role => permission names declared in module files */
    private array $roleGrants = [];

    /** @var list<string> */
    private array $superAdminOnly = [];

    /** @var array<string, list<string>> */
    private array $registered = [];

    public function __construct(private readonly ?string $path = null) {}

    /**
     * @return list<string> every <path>/<Name>/permissions.php
     */
    public function files(): array
    {
        $dirs = glob(rtrim($this->path ?? app_path('Modules'), '/\\').'/*', GLOB_ONLYDIR);
        $files = [];

        foreach ($dirs === false ? [] : $dirs as $dir) {
            if (is_file("{$dir}/permissions.php")) {
                $files[] = "{$dir}/permissions.php";
            }
        }

        sort($files);

        return $files;
    }

    /**
     * Never delegable through roles by anyone but a super admin.
     *
     * @return list<string>
     */
    public function superAdminOnly(): array
    {
        $this->load();

        return $this->superAdminOnly;
    }

    /**
     * Default-role grants declared by the module files ('*' already expanded).
     *
     * @return list<string>
     */
    public function grantsFor(string $role): array
    {
        $this->load();

        return $this->roleGrants[$role] ?? [];
    }

    public function register(string $module, array $names): void
    {
        foreach ($names as $name) {
            if (preg_match('/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/', $name) !== 1) {
                throw new InvalidArgumentException("Invalid permission name [{$name}].");
            }
        }

        $this->registered[$module] = array_values(array_unique([...($this->registered[$module] ?? []), ...$names]));
        $this->modules = null;
    }

    public function grouped(): array
    {
        $grouped = $this->load();
        ksort($grouped);

        return $grouped;
    }

    public function all(): array
    {
        return array_values(array_unique(array_merge([], ...array_values($this->load()))));
    }

    /**
     * Creates missing catalog rows; idempotent.
     */
    public function sync(): void
    {
        $existing = Permission::query()->where('guard_name', self::GUARD)->pluck('name')->all();
        $now = Carbon::now();
        $rows = [];

        foreach ($this->load() as $module => $names) {
            foreach (array_diff($names, $existing) as $name) {
                $rows[] = ['name' => $name, 'guard_name' => self::GUARD, 'module' => $module, 'created_at' => $now, 'updated_at' => $now];
            }
        }

        if ($rows === []) {
            return;
        }

        Permission::query()->insertOrIgnore($rows);
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /**
     * @return array<string, list<string>>
     */
    private function load(): array
    {
        if ($this->modules !== null) {
            return $this->modules;
        }

        $modules = [];
        $owner = [];
        $grants = [];
        $superAdminOnly = [];

        foreach ($this->files() as $file) {
            $declaration = require $file;
            $group = is_array($declaration) ? ($declaration['group'] ?? null) : null;
            $permissions = is_array($declaration) ? ($declaration['permissions'] ?? null) : null;

            if (! is_string($group) || $group === '' || ! is_array($permissions)) {
                throw new InvalidArgumentException("Permission file [{$file}] must return ['group' => string, 'permissions' => array].");
            }

            foreach ($permissions as $name => $options) {
                $name = (string) $name;

                if (preg_match('/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/', $name) !== 1) {
                    throw new InvalidArgumentException("Invalid permission name [{$name}] in [{$file}].");
                }

                if (isset($owner[$name])) {
                    throw new InvalidArgumentException("Duplicate permission [{$name}] declared in [{$owner[$name]}] and [{$file}].");
                }

                $owner[$name] = $file;
                $modules[$group][] = $name;
                $options = is_array($options) ? $options : [];

                if (($options['super_admin_only'] ?? false) === true) {
                    $superAdminOnly[] = $name;
                }

                foreach ((array) ($options['roles'] ?? []) as $role) {
                    if ($role !== '*' && ! in_array($role, self::DEFAULT_ROLES, true)) {
                        throw new InvalidArgumentException("Unknown role [{$role}] for permission [{$name}] in [{$file}].");
                    }

                    foreach ($role === '*' ? self::DEFAULT_ROLES : [$role] as $target) {
                        $grants[$target][] = $name;
                    }
                }
            }
        }

        $this->roleGrants = $grants;
        $this->superAdminOnly = $superAdminOnly;

        foreach ($this->registered as $module => $names) {
            $modules[$module] = array_values(array_unique([...($modules[$module] ?? []), ...$names]));
        }

        return $this->modules = $modules;
    }
}
