<?php

declare(strict_types=1);

return [
    'invalid_vkn' => 'The tax number must be a valid 10-digit VKN.',
    'invalid_tckn' => 'The identity number must be a valid 11-digit T.C. identity number.',
    'invalid_foreign_tax_number' => 'The tax number may contain up to 32 letters, digits, spaces and . - / characters.',
    'tax_number_taken' => 'An active party with this tax number already exists.',
    'invalid_iban' => 'The IBAN is not valid.',
    'iban_taken' => 'This IBAN is already registered for the party.',
    'reference_not_found' => 'The selected value does not exist.',
    'risk_currency_required' => 'A currency is required when a risk limit is set.',
    'duplicate_criteria' => 'Provide a tax number or a name to search for duplicates.',
    'deactivated_in_use' => 'The party is in use and was deactivated instead of deleted.',
    'export_too_large' => 'The export is limited to :max rows; narrow the filters.',
];
