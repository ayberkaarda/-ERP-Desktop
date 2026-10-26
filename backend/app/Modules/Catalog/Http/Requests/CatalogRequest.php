<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Requests;

use App\Core\Company\CompanyContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\Rules\Unique;

/**
 * Policies run before validation, so a caller without the permission never learns validation
 * details. A record that is not found is left to the controller (404).
 */
abstract class CatalogRequest extends FormRequest
{
    public const string DECIMAL = '/^\d{1,14}(\.\d{1,6})?$/';

    public function authorize(): bool
    {
        [$ability, $subject] = $this->gate();

        return Gate::allows($ability, $subject);
    }

    /**
     * Ability and class or record to check.
     *
     * @return array{0: string, 1: class-string<Model>|Model}
     */
    abstract protected function gate(): array;

    /**
     * create on POST, otherwise update of the record named by {$param}.
     *
     * @param  class-string<Model>  $class
     * @return array{0: string, 1: class-string<Model>|Model}
     */
    protected function recordGate(string $class, string $param = 'id'): array
    {
        return $this->creating() ? ['create', $class] : $this->parentGate($class, $param);
    }

    /**
     * update of the owning record (an item for its parts, a list for its lines). The permission is
     * checked before the lookup, so a caller without it gets 403 whether or not the record exists;
     * a missing record is left to the controller (404).
     *
     * @param  class-string<Model>  $class
     * @return array{0: string, 1: class-string<Model>|Model}
     */
    protected function parentGate(string $class, string $param): array
    {
        if (! Gate::allows('updateAny', $class)) {
            return ['updateAny', $class];
        }

        $id = $this->routeId($param);
        $record = $id !== null && Str::isUuid($id) ? $class::query()->find($id) : null;

        return $record instanceof Model ? ['update', $record] : ['updateAny', $class];
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

    /**
     * The active company. Requests always have one (company middleware); the rules are also read
     * without one when the API document is generated, then the nil uuid matches no row.
     */
    protected function company(): string
    {
        return app(CompanyContext::class)->idOrNull() ?? '00000000-0000-0000-0000-000000000000';
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
