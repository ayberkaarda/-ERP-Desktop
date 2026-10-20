<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Identity\Models\Permission;
use Illuminate\Support\Carbon;
use InvalidArgumentException;
use Spatie\Permission\PermissionRegistrar;

/**
 * The permission catalog grouped by module. Phase 1 modules that ship without their own
 * registration (settings, files, notifications, workflow) are declared here.
 */
final class PermissionCatalog implements PermissionRegistry
{
    public const string GUARD = 'web';

    /** @var array<string, list<string>> */
    private array $modules = [
        'identity' => [
            'users.view', 'users.create', 'users.update', 'users.delete', 'users.status', 'users.reset_password',
            'roles.view', 'roles.create', 'roles.update', 'roles.delete', 'roles.assign',
            'audit.view', 'audit.export', 'session_logs.view',
        ],
        'settings' => ['settings.view', 'settings.update'],
        'files' => ['files.view', 'files.create', 'files.delete'],
        'notifications' => ['notifications.view'],
        'workflow' => ['approvals.view', 'approvals.decide', 'approval_flows.manage'],
    ];

    public function register(string $module, array $names): void
    {
        foreach ($names as $name) {
            if (preg_match('/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/', $name) !== 1) {
                throw new InvalidArgumentException("Invalid permission name [{$name}].");
            }
        }

        $this->modules[$module] = array_values(array_unique([...($this->modules[$module] ?? []), ...$names]));
    }

    public function grouped(): array
    {
        $grouped = $this->modules;
        ksort($grouped);

        return $grouped;
    }

    public function all(): array
    {
        return array_values(array_unique(array_merge(...array_values($this->modules))));
    }

    /**
     * Creates missing catalog rows; idempotent.
     */
    public function sync(): void
    {
        $existing = Permission::query()->where('guard_name', self::GUARD)->pluck('name')->all();
        $now = Carbon::now();
        $rows = [];

        foreach ($this->modules as $module => $names) {
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
}
