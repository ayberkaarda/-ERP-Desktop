<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The route names the policy ability and document class (route defaults `ability`, `model`); the
 * permission is checked before validation and before the record is looked up, so a caller without
 * it learns nothing (403); a missing or foreign record is a 404 from the controller.
 */
abstract class SalesRequest extends FormRequest
{
    /** Quantity, price or rate: up to 14 integer and 6 fraction digits. */
    public const string QTY = '/^\d{1,14}(\.\d{1,6})?$/';

    /** Money: up to 16 integer and 4 fraction digits. */
    public const string MONEY = '/^\d{1,16}(\.\d{1,4})?$/';

    public const string PERCENT = '/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/';

    public function authorize(): bool
    {
        $route = $this->route();
        $ability = $route?->defaults['ability'] ?? null;
        $model = $route?->defaults['model'] ?? null;

        return is_string($ability) && is_string($model) && Gate::allows($ability, $model);
    }

    public function optionalVersion(): ?int
    {
        $version = $this->validated('version');

        return is_numeric($version) ? (int) $version : null;
    }

    /** @return array<string, mixed> */
    protected function versionRules(bool $required): array
    {
        return ['version' => [$required ? 'required' : 'sometimes', 'integer', 'min:1']];
    }
}
