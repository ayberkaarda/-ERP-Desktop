<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Console;

use App\Modules\Inventory\Services\ReservationBook;
use App\Modules\Organization\Contracts\CompanyDirectory;

final class ExpireReservations extends CompanyCommand
{
    /** @var string */
    protected $signature = 'inventory:expire-reservations {company? : company id (default: every active company)}';

    /** @var string */
    protected $description = 'Expire active stock reservations whose hold time is over';

    public function handle(ReservationBook $reservations, CompanyDirectory $companies): int
    {
        $ids = $this->companies($companies);

        if ($ids === null) {
            return self::FAILURE;
        }

        foreach ($ids as $id) {
            $this->line("{$id}: ".$reservations->expireDue($id));
        }

        return self::SUCCESS;
    }
}
