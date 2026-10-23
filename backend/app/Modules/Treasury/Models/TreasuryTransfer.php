<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Models;

class TreasuryTransfer extends TreasuryRecord
{
    protected $table = 'treasury_transfers';

    protected function casts(): array
    {
        return [];
    }
}
