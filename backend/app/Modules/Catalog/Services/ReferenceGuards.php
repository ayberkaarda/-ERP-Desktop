<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use Illuminate\Contracts\Container\Container;

/**
 * Existence checks for ids owned by other modules. Each check goes through the Contract of the
 * providing module and only when that module is installed and bound; otherwise the opaque id is
 * accepted as is (the chief adds cross-module foreign keys at integration).
 */
class ReferenceGuards
{
    public const string TAX_CODES = 'App\\Modules\\Reference\\Contracts\\TaxCodeLookup';

    public const string CURRENCIES = 'App\\Modules\\Reference\\Contracts\\CurrencyLookup';

    public const string PARTIES = 'App\\Modules\\Parties\\Contracts\\PartyLookup';

    public function __construct(private readonly Container $app) {}

    public function taxCodeExists(string $id): bool
    {
        $lookup = $this->lookup(self::TAX_CODES);

        return $lookup === null || ! method_exists($lookup, 'find') || $lookup->find($id) !== null;
    }

    public function currencyExists(string $code): bool
    {
        $lookup = $this->lookup(self::CURRENCIES);

        return $lookup === null || ! method_exists($lookup, 'exists') || $lookup->exists($code) === true;
    }

    public function partyExists(string $id): bool
    {
        $lookup = $this->lookup(self::PARTIES);

        return $lookup === null || ! method_exists($lookup, 'find') || $lookup->find($id) !== null;
    }

    /**
     * Default price list of a party, when the Parties module exposes one.
     */
    public function partyPriceListId(string $partyId): ?string
    {
        $lookup = $this->lookup(self::PARTIES);

        if ($lookup === null || ! method_exists($lookup, 'find')) {
            return null;
        }

        $party = $lookup->find($partyId);
        $value = data_get($party, 'price_list_id') ?? data_get($party, 'priceListId');

        return is_string($value) && $value !== '' ? $value : null;
    }

    private function lookup(string $contract): ?object
    {
        if (! interface_exists($contract) || ! $this->app->bound($contract)) {
            return null;
        }

        $service = $this->app->make($contract);

        return is_object($service) ? $service : null;
    }
}
