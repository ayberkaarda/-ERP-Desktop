<?php

declare(strict_types=1);

namespace App\Modules\Files\Services;

/**
 * Extension allowlist; each extension lists the content types sniffed from the bytes that
 * are acceptable for it. The first one is stored as the file's mime.
 */
final class AllowedFileTypes
{
    private const array OLE = ['application/x-ole-storage', 'application/CDFV2', 'application/vnd.ms-office'];

    /**
     * @return array<string, list<string>>
     */
    public static function map(): array
    {
        return [
            'pdf' => ['application/pdf'],
            'png' => ['image/png'],
            'jpg' => ['image/jpeg'],
            'jpeg' => ['image/jpeg'],
            'gif' => ['image/gif'],
            'webp' => ['image/webp'],
            'txt' => ['text/plain'],
            'csv' => ['text/csv', 'text/plain', 'application/csv'],
            'doc' => ['application/msword', ...self::OLE],
            'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
            'xls' => ['application/vnd.ms-excel', ...self::OLE],
            'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
            'ppt' => ['application/vnd.ms-powerpoint', ...self::OLE],
            'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
        ];
    }

    /**
     * Canonical mime for an extension when the sniffed type is acceptable, otherwise null.
     */
    public static function mimeFor(string $extension, string $sniffed): ?string
    {
        $accepted = self::map()[strtolower($extension)] ?? null;

        return $accepted !== null && in_array($sniffed, $accepted, true) ? $accepted[0] : null;
    }
}
