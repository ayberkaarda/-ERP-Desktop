<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Resources;

use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Repositories\ReferenceRepository;
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
        unset($data['deleted_at'], $data[ReferenceRepository::ACTIVE], $data[ReferenceRepository::VERSION]);
        if ($this->resource instanceof Currency) {
            [$active, $version] = $this->activation($this->resource);
            $data['company_is_active'] = $active;
            $data['company_version'] = $version;
            $data['version'] = $version;
        }

        return $data;
    }

    /**
     * The active company's activation: selected with the row by ReferenceRepository (lists and
     * reads), looked up only for a record loaded without it (e.g. right after an update).
     *
     * @return array{0: bool, 1: int}
     */
    private function activation(Currency $currency): array
    {
        $attributes = $currency->getAttributes();
        if (array_key_exists(ReferenceRepository::ACTIVE, $attributes)) {
            $version = $attributes[ReferenceRepository::VERSION];

            return [(bool) $attributes[ReferenceRepository::ACTIVE], is_numeric($version) ? (int) $version : 1];
        }
        $activation = CompanyCurrency::query()->where('currency_code', $currency->getAttribute('code'))->first();

        return [(bool) ($activation?->getAttribute('is_active') ?? false), $activation?->currentVersion() ?? 1];
    }
}
