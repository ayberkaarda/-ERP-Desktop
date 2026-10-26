<?php

declare(strict_types=1);

namespace App\Core;

use App\Core\Company\CompanyContext;
use App\Core\Company\DenyAllMembershipChecker;
use App\Core\Company\MembershipChecker;
use App\Core\Idempotency\EnsureIdempotency;
use App\Core\Idempotency\IdempotencyStore;
use App\Core\Modules\ModuleLoader;
use App\Core\Numbering\NumberSequenceService;
use App\Core\Sync\Schema\Syncable;
use App\Core\Sync\SyncConfig;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\ServiceProvider;
use Spatie\Permission\PermissionRegistrar;

final class CoreServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(CompanyContext::class, static fn (Application $app): CompanyContext => new CompanyContext(
            $app->make(PermissionRegistrar::class),
        ));

        // Identity rebinds this; until then nobody is a member of anything.
        $this->app->bindIf(MembershipChecker::class, DenyAllMembershipChecker::class);

        $this->app->bind(NumberSequenceService::class, static fn (Application $app): NumberSequenceService => new NumberSequenceService(
            $app->make(ConnectionInterface::class),
            self::string($app, 'numbering.format', NumberSequenceService::DEFAULT_FORMAT),
            self::stringMap($app, 'numbering.formats'),
        ));

        $this->app->bind(IdempotencyStore::class, static fn (Application $app): IdempotencyStore => new IdempotencyStore(
            $app->make(ConnectionInterface::class),
            self::int($app, 'idempotency.lease_seconds', 300),
        ));

        $this->app->bind(EnsureIdempotency::class, static fn (Application $app): EnsureIdempotency => new EnsureIdempotency(
            $app->make(ConnectionInterface::class),
            $app->make(CompanyContext::class),
            $app->make(IdempotencyStore::class),
            self::int($app, 'idempotency.ttl_hours', 24),
        ));

        $this->app->bind(SyncConfig::class, static fn (Application $app): SyncConfig => SyncConfig::fromConfig(
            $app->make('config'),
        ));

        (new ModuleLoader($this->app->path('Modules')))->register($this->app);
    }

    public function boot(): void
    {
        Syncable::register();
    }

    private static function string(Application $app, string $key, string $default): string
    {
        $value = $app->make('config')->get($key);

        return is_string($value) && $value !== '' ? $value : $default;
    }

    private static function int(Application $app, string $key, int $default): int
    {
        $value = $app->make('config')->get($key);

        return is_numeric($value) ? (int) $value : $default;
    }

    /**
     * @return array<string, string>
     */
    private static function stringMap(Application $app, string $key): array
    {
        $value = $app->make('config')->get($key);

        return is_array($value) ? array_filter($value, 'is_string') : [];
    }
}
