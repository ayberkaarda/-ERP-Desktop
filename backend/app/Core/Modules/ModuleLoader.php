<?php

declare(strict_types=1);

namespace App\Core\Modules;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

/**
 * Registers every <path>/<Name>/<Name>ServiceProvider.php so modules never edit shared provider files.
 * Class names are built from strings on purpose: Core must not reference module code.
 */
final class ModuleLoader
{
    public function __construct(
        private readonly string $path,
        private readonly string $namespace = 'App\\Modules',
    ) {}

    /**
     * @return list<class-string<ServiceProvider>>
     */
    public function discover(): array
    {
        $dirs = glob(rtrim($this->path, '/\\').'/*', GLOB_ONLYDIR);
        $providers = [];

        foreach ($dirs === false ? [] : $dirs as $dir) {
            $name = basename($dir);

            if (! is_file("{$dir}/{$name}ServiceProvider.php")) {
                continue;
            }

            $class = "{$this->namespace}\\{$name}\\{$name}ServiceProvider";

            if (class_exists($class) && is_subclass_of($class, ServiceProvider::class)) {
                $providers[] = $class;
            }
        }

        sort($providers);

        return $providers;
    }

    /**
     * @return list<class-string<ServiceProvider>>
     */
    public function register(Application $app): array
    {
        $providers = $this->discover();

        foreach ($providers as $provider) {
            $app->register($provider);
        }

        return $providers;
    }
}
