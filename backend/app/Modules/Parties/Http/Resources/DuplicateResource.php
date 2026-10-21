<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Resources;

use App\Modules\Parties\Models\Party;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{party: Party, reasons: list<string>, similarity: float} $resource
 */
final class DuplicateResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $party = $this->resource['party'];

        return [
            'id' => $party->id,
            'code' => $party->code,
            'name' => $party->name,
            'legal_name' => $party->legal_name,
            'type' => $party->type->value,
            'roles' => $party->roles,
            'tax_number' => $party->tax_number,
            'is_active' => $party->is_active,
            'reasons' => $this->resource['reasons'],
            'similarity' => $this->resource['similarity'],
        ];
    }
}
