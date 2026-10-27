<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use App\Core\Sync\Rules\ClientKey;
use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Enums\PartyType;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Support\Messages;
use App\Modules\Parties\Support\ReferenceGuards;
use App\Modules\Parties\Validation\TaxNumber;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * POST creates, PATCH updates (partial, `version` required). Cross-field rules (tax number by
 * type/country, uniqueness, risk currency) run on the merged state of the stored party and the
 * payload, so a PATCH of only `type` is checked against the stored tax number.
 *
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class PartyRequest extends FormRequest
{
    public const string AMOUNT = '/\A\d{1,16}(\.\d{1,4})?\z/';

    private ?Party $existing = null;

    private bool $resolved = false;

    /**
     * Authorization before validation, so callers without access never learn validation details.
     */
    public function authorize(): bool
    {
        if ($this->creating()) {
            return Gate::allows('create', Party::class);
        }

        $party = $this->existing() ?? throw (new ModelNotFoundException)->setModel(Party::class);

        return Gate::allows('update', $party);
    }

    public function creating(): bool
    {
        // POST is the only creating route; decided by the method so the API document sees it too.
        return $this->isMethod('POST');
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        $creating = $this->creating();
        $required = $creating ? 'required' : 'sometimes';

        return [
            ...$creating ? ['id' => ['sometimes', 'bail', new ClientKey('parties'), 'uuid']] : [],
            'code' => ['prohibited'],
            'version' => [$creating ? 'prohibited' : 'required', 'integer', 'min:1'],
            'name' => [$required, 'string', 'max:255'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'type' => [$required, 'string', Rule::in(PartyType::values())],
            'roles' => [$required, 'array', 'min:1', 'max:'.count(PartyRole::cases())],
            'roles.*' => ['required', 'string', 'distinct', Rule::in(PartyRole::values())],
            'tax_office' => ['sometimes', 'nullable', 'string', 'max:100'],
            'tax_number' => ['sometimes', 'nullable', 'string', 'max:'.TaxNumber::MAX_FOREIGN_LENGTH],
            'country' => ['sometimes', 'string', 'regex:/\A[A-Z]{2}\z/'],
            'default_currency_code' => ['sometimes', 'nullable', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'payment_term_id' => ['sometimes', 'nullable', 'uuid'],
            'price_list_id' => ['sometimes', 'nullable', 'uuid'],
            'risk_limit' => ['sometimes', 'nullable', 'regex:'.self::AMOUNT],
            'risk_currency_code' => ['sometimes', 'nullable', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'is_active' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'tags' => ['sometimes', 'nullable', 'array', 'max:20'],
            'tags.*' => ['required', 'string', 'max:50'],
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $this->checkTaxNumber($validator);
            $this->checkReferences($validator);

            $limit = $this->effective('risk_limit');
            $currency = $this->effective('risk_currency_code') ?? $this->effective('default_currency_code');

            if ($limit !== null && $currency === null) {
                $validator->errors()->add('risk_currency_code', Messages::get('risk_currency_required'));
            }
        }];
    }

    /**
     * The party being updated (company scoped), null on create.
     */
    public function existing(): ?Party
    {
        if (! $this->resolved) {
            $this->resolved = true;
            $id = $this->route('party');
            $this->existing = is_string($id) ? Party::query()->find($id) : null;
        }

        return $this->existing;
    }

    protected function prepareForValidation(): void
    {
        $merge = [];

        foreach (['country', 'default_currency_code', 'risk_currency_code'] as $key) {
            $value = $this->input($key);
            if (is_string($value)) {
                $merge[$key] = strtoupper(trim($value));
            }
        }

        $taxNumber = $this->input('tax_number');

        if (is_string($taxNumber)) {
            $country = $merge['country'] ?? $this->existing()->country ?? 'TR';
            $normalized = TaxNumber::normalize($taxNumber, $country);
            $merge['tax_number'] = $normalized === '' ? null : $normalized;
        }

        if (is_int($this->input('risk_limit')) || is_float($this->input('risk_limit'))) {
            $merge['risk_limit'] = (string) $this->input('risk_limit');
        }

        $this->merge($merge);
    }

    private function checkTaxNumber(Validator $validator): void
    {
        $number = $this->effective('tax_number');

        if (! is_string($number)) {
            return;
        }

        $type = PartyType::from((string) $this->effective('type'));
        $country = (string) ($this->effective('country') ?? 'TR');

        $error = TaxNumber::error($type, $country, $number);

        if ($error !== null) {
            $validator->errors()->add('tax_number', Messages::get($error));

            return;
        }

        if (! (bool) ($this->effective('is_active') ?? true)) {
            return;
        }

        $query = Party::query()->where('tax_number_canonical', TaxNumber::canonical($number))->where('is_active', true);

        if ($this->existing() !== null) {
            $query->whereKeyNot($this->existing()->id);
        }

        if ($query->exists()) {
            $validator->errors()->add('tax_number', Messages::get('tax_number_taken'));
        }
    }

    private function checkReferences(Validator $validator): void
    {
        $guards = app(ReferenceGuards::class);
        $checks = [
            'default_currency_code' => $guards->currencyExists(...),
            'risk_currency_code' => $guards->currencyExists(...),
            'payment_term_id' => $guards->paymentTermExists(...),
            'price_list_id' => $guards->priceListExists(...),
        ];

        foreach ($checks as $field => $exists) {
            $value = $this->input($field);

            if (is_string($value) && ! $exists($value)) {
                $validator->errors()->add($field, Messages::get('reference_not_found'));
            }
        }
    }

    /**
     * Payload value when sent, otherwise the stored one (raw attribute values).
     */
    private function effective(string $key): mixed
    {
        if ($this->exists($key)) {
            return $this->input($key);
        }

        $party = $this->existing();

        if ($party === null) {
            return null;
        }

        $value = $party->getAttributes()[$key] ?? null;

        return $key === 'is_active' && $value !== null ? (bool) $value : $value;
    }
}
