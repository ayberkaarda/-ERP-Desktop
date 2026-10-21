<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Requests;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The permission is checked before validation and before the record is looked up, so a caller
 * without it learns nothing (403); a missing or foreign record is a 404 from the controller.
 */
abstract class AccountingRequest extends FormRequest
{
    public const string MONEY = '/^\d{1,16}(\.\d{1,4})?$/';

    public function authorize(): bool
    {
        [$ability, $class] = $this->gate();

        return Gate::allows($ability, $class);
    }

    /**
     * @return array{0: string, 1: class-string<Model>}
     */
    abstract protected function gate(): array;

    protected function creating(): bool
    {
        return $this->isMethod('POST');
    }

    protected function required(): string
    {
        return $this->creating() ? 'required' : 'sometimes';
    }

    /** @return list<string> */
    protected function versionRule(): array
    {
        return $this->creating() ? ['prohibited'] : ['required', 'integer', 'min:1'];
    }

    public function optionalVersion(): ?int
    {
        $version = $this->validated('version');

        return is_numeric($version) ? (int) $version : null;
    }
}
