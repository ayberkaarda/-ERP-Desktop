<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Resources;

use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\Currency;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property Model $resource */
final class ReferenceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $data = $this->resource->toArray();
        unset($data['deleted_at']);
        if ($this->resource instanceof Currency) {
            $activation = CompanyCurrency::query()
                ->where('currency_code', $this->resource->getAttribute('code'))->first();
            $data['company_is_active'] = $activation?->getAttribute('is_active') ?? false;
            $data['company_version'] = $activation?->currentVersion() ?? 1;
            $data['version'] = $data['company_version'];
        }

        return $data;
    }
}
