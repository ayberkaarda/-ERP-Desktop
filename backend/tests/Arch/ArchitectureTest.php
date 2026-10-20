<?php

declare(strict_types=1);

arch('application code declares strict types')
    ->expect('App')
    ->toUseStrictTypes();

arch('core does not depend on modules')
    ->expect('App\Core')
    ->not->toUse('App\Modules');

arch('no debugging leftovers')
    ->expect(['dd', 'dump', 'ray', 'var_dump', 'die'])
    ->not->toBeUsed();

arch('enums in core are backed')
    ->expect('App\Core')
    ->enums()
    ->toBeStringBackedEnums();

/**
 * @return list<string>
 */
function moduleNames(): array
{
    $dirs = glob(dirname(__DIR__, 2).'/app/Modules/*', GLOB_ONLYDIR);

    return array_values(array_map('basename', $dirs === false ? [] : $dirs));
}

test('modules do not reach into other modules models or repositories', function (): void {
    $modules = moduleNames();

    foreach ($modules as $module) {
        $forbidden = [];

        foreach ($modules as $other) {
            if ($other !== $module) {
                $forbidden[] = "App\\Modules\\{$other}\\Models";
                $forbidden[] = "App\\Modules\\{$other}\\Repositories";
            }
        }

        if ($forbidden !== []) {
            expect("App\\Modules\\{$module}")->not->toUse($forbidden);
        }
    }

    expect($modules)->toBeArray();
});
