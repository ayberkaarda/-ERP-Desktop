<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use App\Modules\Parties\Models\Party;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * Shared shape of sub-resource writes: POST creates (version prohibited), PATCH updates
 * partially and needs `version`. The child route parameter tells them apart.
 */
abstract class ChildRequest extends FormRequest
{
    /**
     * Writes need parties.update on the owning party; an unknown party is a 404.
     */
    public function authorize(): bool
    {
        $id = $this->route('party');
        $party = is_string($id) ? Party::query()->find($id) : null;

        if (! $party instanceof Party) {
            throw (new ModelNotFoundException)->setModel(Party::class);
        }

        return Gate::allows('update', $party);
    }

    protected function creating(): bool
    {
        return $this->route('child') === null;
    }

    protected function required(): string
    {
        return $this->creating() ? 'required' : 'sometimes';
    }

    /** @return list<string> */
    protected function versionRule(): array
    {
        return [$this->creating() ? 'prohibited' : 'required', 'integer', 'min:1'];
    }

    /**
     * @param  list<string>  $keys
     */
    protected function upper(array $keys): void
    {
        $merge = [];

        foreach ($keys as $key) {
            $value = $this->input($key);
            if (is_string($value)) {
                $merge[$key] = strtoupper(trim($value));
            }
        }

        $this->merge($merge);
    }
}
