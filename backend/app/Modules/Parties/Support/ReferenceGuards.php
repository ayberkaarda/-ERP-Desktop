<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

use Illuminate\Contracts\Container\Container;

/**
 * Existence checks for ids owned by other modules, through those modules' Contracts when they are
 * installed. Until a providing module exists (interface missing or not bound), the value is
 * accepted as an opaque, format-checked identifier.
 */
final class ReferenceGuards
{
    public const string CURRENCY = 'App\Modules\Reference\Contracts\CurrencyLookup';

    public const string PAYMENT_TERM = 'App\Modules\Reference\Contracts\PaymentTermLookup';

    public const string PRICE_LIST = 'App\Modules\Catalog\Contracts\PriceListLookup';

    /**
     * @param  array{currency?: string, payment_term?: string, price_list?: string}  $contracts  overrides for tests
     */
    public function __construct(private readonly Container $container, private readonly array $contracts = []) {}

    public function currencyExists(string $code): bool
    {
        return $this->check($this->contracts['currency'] ?? self::CURRENCY, $code);
    }

    public function paymentTermExists(string $id): bool
    {
        return $this->check($this->contracts['payment_term'] ?? self::PAYMENT_TERM, $id);
    }

    public function priceListExists(string $id): bool
    {
        return $this->check($this->contracts['price_list'] ?? self::PRICE_LIST, $id);
    }

    /**
     * True when the providing module confirms the value, or cannot be asked yet.
     */
    public function check(string $contract, string $value): bool
    {
        if (! interface_exists($contract) || ! $this->container->bound($contract)) {
            return true;
        }

        $lookup = $this->container->make($contract);

        if (! is_object($lookup) || ! method_exists($lookup, 'exists')) {
            return true;
        }

        return $lookup->exists($value) === true;
    }
}
