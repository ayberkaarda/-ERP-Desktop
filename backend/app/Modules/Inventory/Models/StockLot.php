<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use Illuminate\Support\Carbon;

/**
 * @property string $item_id
 * @property string $lot_no
 * @property Carbon|null $expiry_date
 * @property Carbon|null $manufacture_date
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class StockLot extends InventoryModel
{
    public const array FIELDS = ['lot_no', 'expiry_date', 'manufacture_date'];

    /** @var list<string> */
    protected $fillable = ['item_id', 'lot_no', 'expiry_date', 'manufacture_date'];

    public function getMorphClass(): string
    {
        return 'stock_lot';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['expiry_date' => 'date', 'manufacture_date' => 'date'];
    }
}
