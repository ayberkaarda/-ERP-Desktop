<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use App\Modules\Parties\Support\Messages;
use App\Modules\Parties\Support\ReferenceGuards;
use App\Modules\Parties\Validation\Iban;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * IBAN is stored in electronic format (no spaces, upper case) and must pass Iban::isValid
 * (mod 97 plus the TR layout for Turkish accounts); unique per party.
 *
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class BankAccountRequest extends ChildRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        $unique = Rule::unique('party_bank_accounts', 'iban')->where('party_id', (string) $this->route('party'));
        $child = $this->route('child');

        if (is_string($child)) {
            $unique->ignore($child);
        }

        return [
            'version' => $this->versionRule(),
            'bank_name' => [$this->required(), 'string', 'max:200'],
            'iban' => [$this->required(), 'bail', 'string', 'max:34', function (string $attribute, mixed $value, \Closure $fail): void {
                if (! is_string($value) || ! Iban::isValid($value)) {
                    $fail(Messages::get('invalid_iban'));
                }
            }, $unique],
            'swift' => ['sometimes', 'nullable', 'string', 'regex:/\A[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?\z/'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'regex:/\A[A-Z]{3}\z/'],
            'is_default' => ['sometimes', 'boolean'],
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $currency = $this->input('currency_code');

            if ($validator->errors()->isEmpty() && is_string($currency) && ! app(ReferenceGuards::class)->currencyExists($currency)) {
                $validator->errors()->add('currency_code', Messages::get('reference_not_found'));
            }
        }];
    }

    protected function prepareForValidation(): void
    {
        $this->upper(['swift', 'currency_code']);
        $iban = $this->input('iban');

        if (is_string($iban)) {
            $this->merge(['iban' => Iban::normalize($iban)]);
        }
    }
}
