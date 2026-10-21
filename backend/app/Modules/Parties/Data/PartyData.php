<?php

declare(strict_types=1);

namespace App\Modules\Parties\Data;

use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Enums\PartyType;
use App\Modules\Parties\Models\Party;

/**
 * Snapshot of a party handed to other modules. risk_limit is a decimal string (scale 4).
 */
final readonly class PartyData
{
    /**
     * @param  list<PartyRole>  $roles
     */
    public function __construct(
        public string $id,
        public string $companyId,
        public string $code,
        public string $name,
        public ?string $legalName,
        public PartyType $type,
        public array $roles,
        public ?string $taxOffice,
        public ?string $taxNumber,
        public string $country,
        public ?string $defaultCurrencyCode,
        public ?string $paymentTermId,
        public ?string $priceListId,
        public ?string $riskLimit,
        public ?string $riskCurrencyCode,
        public bool $isActive,
    ) {}

    public static function fromModel(Party $party): self
    {
        return new self(
            id: $party->id,
            companyId: $party->company_id,
            code: $party->code,
            name: $party->name,
            legalName: $party->legal_name,
            type: $party->type,
            roles: array_values(array_filter(array_map(PartyRole::tryFrom(...), $party->roles))),
            taxOffice: $party->tax_office,
            taxNumber: $party->tax_number,
            country: $party->country,
            defaultCurrencyCode: $party->default_currency_code,
            paymentTermId: $party->payment_term_id,
            priceListId: $party->price_list_id,
            riskLimit: $party->risk_limit?->__toString(),
            riskCurrencyCode: $party->risk_currency_code,
            isActive: $party->is_active,
        );
    }

    public function hasRole(PartyRole $role): bool
    {
        return in_array($role, $this->roles, true);
    }

    public function isCustomer(): bool
    {
        return $this->hasRole(PartyRole::Customer);
    }

    public function isSupplier(): bool
    {
        return $this->hasRole(PartyRole::Supplier);
    }
}
