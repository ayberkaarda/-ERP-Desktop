<?php

declare(strict_types=1);

/** Use --stdin (or -) to read php artisan route:list --json output from stdin. */
function normalizeManifestPath(string $path): string
{
    return preg_replace('/\{[^\/{}]+\}/', '{param}', '/'.trim($path, '/'));
}

function readManifestRoutes(bool $stdin): string
{
    if ($stdin) {
        $json = stream_get_contents(STDIN);
        if ($json === false) {
            throw new RuntimeException('Cannot read routes from stdin.');
        }

        return $json;
    }

    $process = proc_open(
        [PHP_BINARY, 'artisan', 'route:list', '--json'],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', 'php://stderr', 'w']],
        $pipes,
        dirname(__DIR__),
    );
    if (! is_resource($process)) {
        throw new RuntimeException('Cannot start artisan route:list.');
    }
    fclose($pipes[0]);
    $json = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $status = proc_close($process);
    if ($status !== 0 || $json === false) {
        throw new RuntimeException('artisan route:list failed (exit '.$status.').');
    }

    return $json;
}

try {
    $arguments = array_slice($argv, 1);
    if (array_diff($arguments, ['--stdin', '-']) !== []) {
        throw new RuntimeException('Usage: php scripts/check-offline-manifest.php [--stdin|-]');
    }
    $manifestFile = dirname(__DIR__, 2).'/contracts/offline-manifest.json';
    $manifest = json_decode((string) file_get_contents($manifestFile), true, flags: JSON_THROW_ON_ERROR);
    $routes = json_decode(readManifestRoutes($arguments !== []), true, flags: JSON_THROW_ON_ERROR);
    if (! is_array($routes) || ! array_is_list($routes)) {
        throw new RuntimeException('Route output must be a JSON array.');
    }
    $available = [];
    foreach ($routes as $route) {
        if (! is_array($route) || ! isset($route['method'], $route['uri'])
            || ! is_string($route['method']) || ! is_string($route['uri'])) {
            throw new RuntimeException('Route output contains an invalid route.');
        }
        foreach (explode('|', strtoupper($route['method'])) as $method) {
            $available[$method.' '.normalizeManifestPath($route['uri'])] = true;
        }
    }

    $expected = [];
    $add = static function (string $method, string $path) use (&$expected, $manifest): void {
        if (! str_starts_with($path, $manifest['api_prefix'].'/')) {
            throw new RuntimeException('Manifest path is outside api_prefix: '.$path);
        }
        $key = strtoupper($method).' '.normalizeManifestPath($path);
        $expected[$key] = strtoupper($method).' '.$path;
    };
    $addRoute = static function (string $route) use ($add): void {
        if (! preg_match('/^(GET|POST|PUT|PATCH|DELETE) (\/\S+)$/D', $route, $matches)) {
            throw new RuntimeException('Invalid manifest route: '.$route);
        }
        $add($matches[1], $matches[2]);
    };
    $visitResource = static function (array $resource) use (&$visitResource, $add, $addRoute): void {
        // Collection, detail and snapshot paths are read with GET.
        $add('GET', $resource['path']);
        if (isset($resource['detail_path'])) {
            $add('GET', $resource['detail_path']);
        }
        foreach ($resource['write']['ops'] ?? [] as $operation) {
            $addRoute($operation['route']);
        }
        if (isset($resource['write']['duplicate_check'])) {
            $addRoute($resource['write']['duplicate_check']);
        }
        foreach ($resource['children'] ?? [] as $child) {
            $visitResource($child);
        }
    };
    foreach ($manifest['resources'] as $resource) {
        $visitResource($resource);
    }
    foreach ($manifest['online_only'] as $flow) {
        foreach ($flow['routes'] as $route) {
            $addRoute($route);
        }
    }
    if ($expected === []) {
        throw new RuntimeException('Manifest contains no endpoints.');
    }
    $missing = 0;
    foreach ($expected as $key => $display) {
        if (! isset($available[$key])) {
            fwrite(STDOUT, 'MISS '.$display.PHP_EOL);
            $missing++;
        }
    }
    fwrite(STDOUT, 'Summary: '.count($expected).' endpoints, '.$missing.' missing.'.PHP_EOL);
    exit($missing > 0 ? 1 : 0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'FAIL '.$exception->getMessage().PHP_EOL);
    exit(1);
}
