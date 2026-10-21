<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Core\Company\CompanyContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\Rules\Unique;

/**
 * Authorization happens in controllers through policies; these requests only validate.
 */
abstract class CatalogRequest extends FormRequest
{
    public const string DECIMAL = '/^\d{1,14}(\.\d{1,6})?$/';

    public function authorize(): bool
    {
        return true;
    }

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

    protected function company(): string
    {
        return app(CompanyContext::class)->id();
    }

    /** Unique among live rows of the active company (soft-deleted rows free their code). */
    protected function unique(string $table, string $column, ?string $ignore, bool $softDeletes = true): Unique
    {
        $rule = new Unique($table, $column);
        $rule->where('company_id', $this->company());

        if ($softDeletes) {
            $rule->whereNull('deleted_at');
        }

        return $ignore === null ? $rule : $rule->ignore($ignore);
    }

    /** Live row of the active company. */
    protected function existing(string $table, bool $softDeletes = true): Exists
    {
        $rule = new Exists($table, 'id');
        $rule->where('company_id', $this->company());

        return $softDeletes ? $rule->whereNull('deleted_at') : $rule;
    }

    protected function routeId(string $name): ?string
    {
        $value = $this->route($name);

        return is_string($value) ? $value : null;
    }
}
