<?php

declare(strict_types=1);

namespace App\Modules\Settings\Http\Resources;

use App\Modules\Settings\Data\SettingDefinition;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array{definition: SettingDefinition, value: mixed, is_default: bool} $resource
 */
final class SettingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $definition = $this->resource['definition'];
        $labelKey = 'settings::registry.'.$definition->key;
        $label = __($labelKey);

        return [
            'key' => $definition->key,
            'group' => $definition->group,
            'label' => is_string($label) && $label !== $labelKey ? $label : $definition->key,
            'type' => $definition->type->value,
            'options' => $definition->options,
            'default' => $definition->default,
            'value' => $this->resource['value'],
            'is_default' => $this->resource['is_default'],
        ];
    }
}
