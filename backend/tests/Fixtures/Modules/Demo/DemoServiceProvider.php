<?php

declare(strict_types=1);

namespace Tests\Fixtures\Modules\Demo;

use App\Core\Modules\ModuleServiceProvider;

final class DemoServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->instance('demo.module.registered', true);
    }
}
