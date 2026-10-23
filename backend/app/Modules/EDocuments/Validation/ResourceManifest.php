<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Validation;

use Throwable;

final class ResourceManifest
{
    public function valid(): bool
    {
        try {
            $root = realpath(dirname(__DIR__).'/Resources');
            if ($root === false) {
                return false;
            }
            /** @var array{files:list<array{path:string,sha256:string}>} $manifest */
            $manifest = json_decode((string) file_get_contents($root.'/official-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
            foreach ($manifest['files'] as $entry) {
                $path = realpath($root.'/'.$entry['path']);
                if ($path === false || ! str_starts_with($path, $root.DIRECTORY_SEPARATOR) || ! hash_equals($entry['sha256'], (string) hash_file('sha256', $path))) {
                    return false;
                }
            }

            return $manifest['files'] !== [];
        } catch (Throwable) {
            return false;
        }
    }
}
