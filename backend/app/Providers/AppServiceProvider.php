<?php

declare(strict_types=1);

namespace App\Providers;

use App\Core\CoreServiceProvider;
use App\Core\Http\ErrorEnvelopeDocument;
use Dedoc\Scramble\Scramble;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Core also discovers and registers every module provider.
        $this->app->register(CoreServiceProvider::class);
    }

    public function boot(): void
    {
        Scramble::afterOpenApiGenerated(new ErrorEnvelopeDocument);
    }
}
