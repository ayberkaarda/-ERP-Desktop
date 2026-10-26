<?php

declare(strict_types=1);

namespace App\Modules\Files\Contracts;

use App\Modules\Files\Data\ScanResult;

/**
 * Hook for a virus scanner. Runs on the local temp file before anything is stored.
 */
interface FileScanner
{
    public function scan(string $localPath, string $originalName): ScanResult;
}
