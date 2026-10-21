<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use App\Modules\Parties\Models\Party;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * DELETE carries the version the client saw (body or query string). Authorization runs first:
 * deleting a party needs parties.delete, deleting a sub-resource parties.update on its party.
 */
final class VersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $id = $this->route('party');
        $party = is_string($id) ? Party::query()->find($id) : null;

        if (! $party instanceof Party) {
            throw (new ModelNotFoundException)->setModel(Party::class);
        }

        return Gate::allows($this->route('child') === null ? 'delete' : 'update', $party);
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['version' => ['required', 'integer', 'min:1']];
    }
}
