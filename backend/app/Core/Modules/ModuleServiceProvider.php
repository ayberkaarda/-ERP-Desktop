<?php

declare(strict_types=1);

namespace App\Core\Modules;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use ReflectionClass;

/**
 * Optional base for module providers: loads routes.php under api/v1 (middleware `api`),
 * Database/migrations and lang/ (namespace = lowercase module name, e.g. __('identity::auth.x')).
 */
abstract class ModuleServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->bootModule();
    }

    protected function bootModule(): void
    {
        $dir = $this->moduleDirectory();

        if (is_dir("{$dir}/Database/migrations")) {
            $this->loadMigrationsFrom("{$dir}/Database/migrations");
        }

        if (is_dir("{$dir}/lang")) {
            $this->loadTranslationsFrom("{$dir}/lang", $this->moduleKey());
        }

        if (is_file("{$dir}/routes.php") && ! $this->app->routesAreCached()) {
            Route::prefix('api/v1')->middleware('api')->group("{$dir}/routes.php");
        }
    }

    protected function moduleDirectory(): string
    {
        $file = (new ReflectionClass($this))->getFileName();

        return $file === false ? '' : dirname($file);
    }

    protected function moduleKey(): string
    {
        return strtolower(basename($this->moduleDirectory()));
    }
}
