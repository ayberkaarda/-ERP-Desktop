<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

use App\Core\Company\CompanyContext;
use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Container\Container;

/**
 * Existence checks for ids owned by other modules, through those modules' Contracts. The lookups
 * answer for the active company (a company scoped record of another company does not exist for
 * them) and are always called inside it; without an active company nothing is verified.
 *
 * When a providing module is not installed (interface missing or not bound) the reference cannot
 * be verified and is rejected, unless config `parties.allow_unverified_references` is on (meant
 * only for the period before Reference / Catalog exist); then the format-checked value is kept.
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
     * True only when the providing module confirms the value in the active company, or when
     * unverified references are explicitly allowed and the module cannot be asked.
     */
    public function check(string $contract, string $value): bool
    {
        $company = $this->container->make(CompanyContext::class)->idOrNull();

        if ($company === null) {
            return false;
        }

        if (! interface_exists($contract) || ! $this->container->bound($contract)) {
            return $this->allowUnverified();
        }

        $lookup = $this->container->make($contract);

        if (! is_object($lookup) || ! method_exists($lookup, 'exists')) {
            return $this->allowUnverified();
        }

        return $this->container->make(CompanyContext::class)->runAs($company, static fn (): bool => $lookup->exists($value) === true);
    }

    private function allowUnverified(): bool
    {
        return $this->container->make(Repository::class)->get('parties.allow_unverified_references') === true;
    }
}
