<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use Maatwebsite\Excel\Concerns\Import;

/**
 * Import object for Excel::toArray (raw rows; the header is handled by AccountImporter).
 */
final class AccountImportSheet implements Import {}
