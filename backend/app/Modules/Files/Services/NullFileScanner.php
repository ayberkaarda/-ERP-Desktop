<?php

declare(strict_types=1);

namespace App\Modules\Files\Services;

use App\Modules\Files\Contracts\FileScanner;
use App\Modules\Files\Data\ScanResult;

final class NullFileScanner implements FileScanner
{
    public function scan(string $localPath, string $originalName): ScanResult
    {
        return ScanResult::clean();
    }
}
