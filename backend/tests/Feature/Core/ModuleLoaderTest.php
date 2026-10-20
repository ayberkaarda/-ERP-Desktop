<?php

declare(strict_types=1);

use App\Core\Modules\ModuleLoader;
use Illuminate\Support\Facades\Route;
use Tests\Fixtures\Modules\Demo\DemoServiceProvider;

beforeEach(function (): void {
    $this->fixtures = dirname(__DIR__, 2).'/Fixtures/Modules';
});

it('tolerates a missing or empty modules directory', function (): void {
    expect((new ModuleLoader($this->fixtures.'/does-not-exist', 'Tests\\Fixtures\\Modules'))->discover())->toBe([])
        ->and((new ModuleLoader(app_path('Modules')))->register(app()))->toBeArray();
});

it('discovers only folders with a matching provider', function (): void {
    $loader = new ModuleLoader($this->fixtures, 'Tests\\Fixtures\\Modules');

    expect($loader->discover())->toBe([DemoServiceProvider::class]);
});

it('registers module providers with routes under api/v1, lang and migrations', function (): void {
    $registered = (new ModuleLoader($this->fixtures, 'Tests\\Fixtures\\Modules'))->register(app());
    Route::getRoutes()->refreshNameLookups();

    expect($registered)->toBe([DemoServiceProvider::class])
        ->and(app('demo.module.registered'))->toBeTrue()
        ->and(array_map(fn (string $p): string => str_replace('\\', '/', $p), app('migrator')->paths()))
        ->toContain(str_replace('\\', '/', $this->fixtures).'/Demo/Database/migrations');

    $this->getJson('/api/v1/_demo/ping')->assertOk()->assertExactJson(['data' => 'pong']);
});
