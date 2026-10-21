<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Resources;

use App\Modules\Parties\Models\Party;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Party */
final class PartyResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'company_id' => $this->company_id,
            'code' => $this->code,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'type' => $this->type->value,
            'roles' => $this->roles,
            'tax_office' => $this->tax_office,
            'tax_number' => $this->tax_number,
            'country' => $this->country,
            'default_currency_code' => $this->default_currency_code,
            'payment_term_id' => $this->payment_term_id,
            'price_list_id' => $this->price_list_id,
            'risk_limit' => $this->risk_limit?->__toString(),
            'risk_currency_code' => $this->risk_currency_code,
            'is_active' => $this->is_active,
            'notes' => $this->notes,
            'tags' => $this->tags,
            'version' => $this->version,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'addresses' => PartyAddressResource::collection($this->whenLoaded('addresses')),
            'contacts' => PartyContactResource::collection($this->whenLoaded('contacts')),
            'bank_accounts' => PartyBankAccountResource::collection($this->whenLoaded('bankAccounts')),
        ];
    }
}
