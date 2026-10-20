<?php

declare(strict_types=1);

namespace App\Modules\Files\Services;

use ZipArchive;

/**
 * Structural check for Office Open XML uploads, so a renamed ZIP or archive bomb is not accepted.
 */
final class OoxmlPackage
{
    public const int MAX_ENTRIES = 5000;

    public const int MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

    public const int MAX_RATIO = 100;

    private const array MAIN_PARTS = [
        'docx' => 'word/document.xml',
        'xlsx' => 'xl/workbook.xml',
        'pptx' => 'ppt/presentation.xml',
    ];

    public static function handles(string $extension): bool
    {
        return isset(self::MAIN_PARTS[strtolower($extension)]);
    }

    public static function isValid(string $path, string $extension): bool
    {
        $main = self::MAIN_PARTS[strtolower($extension)] ?? null;
        $zip = new ZipArchive;

        if ($main === null || $zip->open($path, ZipArchive::RDONLY) !== true) {
            return false;
        }

        try {
            if ($zip->numFiles < 1 || $zip->numFiles > self::MAX_ENTRIES) {
                return false;
            }

            $names = [];
            $total = 0;

            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);

                if ($stat === false || str_contains($stat['name'], '..') || str_starts_with($stat['name'], '/')) {
                    return false;
                }

                $total += $stat['size'];

                if ($total > self::MAX_UNCOMPRESSED_BYTES) {
                    return false;
                }
                if ($stat['size'] > 0 && ($stat['comp_size'] === 0 || $stat['size'] / $stat['comp_size'] > self::MAX_RATIO)) {
                    return false;
                }

                $names[$stat['name']] = true;
            }

            return isset($names['[Content_Types].xml'], $names[$main]);
        } finally {
            $zip->close();
        }
    }
}
