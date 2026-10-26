<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Contracts;

use App\Modules\Accounting\Data\AccountRef;

interface JournalPartyAccountLookup
{
    /**
     * @param  array<string,array{party_id:string,side:string,amount:string}>  $requests
     * @return array<string,AccountRef>
     */
    public function findMany(array $requests): array;
}
