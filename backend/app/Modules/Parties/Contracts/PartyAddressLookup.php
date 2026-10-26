<?php

declare(strict_types=1);

namespace App\Modules\Parties\Contracts;

/**
 * Addresses of parties of the active company for documents that snapshot them (sales, purchasing).
 */
interface PartyAddressLookup
{
    /**
     * The default billing address (else the oldest billing address) of the party, or null.
     *
     * @return array{label: string|null, line1: string, line2: string|null, district: string|null, city: string|null, postal_code: string|null, country: string}|null
     */
    public function billingAddress(string $partyId): ?array;
}
