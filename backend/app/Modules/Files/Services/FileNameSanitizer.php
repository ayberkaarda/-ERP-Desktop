<?php

declare(strict_types=1);

namespace App\Modules\Files\Services;

/**
 * Display-name cleanup only. The storage key never contains any part of the client name.
 */
final class FileNameSanitizer
{
    private const int MAX_LENGTH = 150;

    public static function clean(string $name): string
    {
        $name = mb_scrub($name, 'UTF-8');
        $name = basename(str_replace('\\', '/', $name));
        // Control chars and bidi/zero-width marks that can disguise an extension.
        $name = (string) preg_replace('/[\x00-\x1F\x7F\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $name);
        $name = (string) preg_replace('/[<>:"|?*\/\\\\]/u', '_', $name);
        $name = (string) preg_replace('/\s+/u', ' ', $name);
        $name = trim($name, '. ');

        if (mb_strlen($name) > self::MAX_LENGTH) {
            $ext = pathinfo($name, PATHINFO_EXTENSION);
            $base = mb_substr(pathinfo($name, PATHINFO_FILENAME), 0, self::MAX_LENGTH - mb_strlen($ext) - 1);
            $name = $ext === '' ? $base : $base.'.'.$ext;
        }

        return $name === '' ? 'file' : $name;
    }
}
