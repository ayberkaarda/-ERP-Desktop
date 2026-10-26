<?php

declare(strict_types=1);

return [
    'invalid_date' => 'Enter a valid document date.',
    'invalid_content' => 'The statement is empty, too large, malformed, or exceeds the supported line limit.',
    'invalid_format' => 'The statement format or parsing option is unsupported.',
    'invalid_amount' => 'Use an exact decimal amount without thousands separators or exponent notation.',
    'invalid_currency' => 'The currency does not match the selected account.',
    'balance_mismatch' => 'Opening balance plus transactions must equal closing balance.',
    'invalid_mt940' => 'Use one complete final MT940 statement with supported tags.',
    'invalid_account' => 'Select an active account with a compatible type and currency.',
    'account_reference_mismatch' => 'The statement account reference does not match the bank account IBAN.',
    'duplicate_statement' => 'This statement has already been imported.',
    'payment_matched' => 'Unmatch the bank statement line before reusing or reversing this movement.',
    'payment_mismatch' => 'Select an unreversed posted movement with the same account, currency, sign, and amount.',
    'unmatched_lines' => 'Match all statement lines to unreversed posted movements first.',
    'invalid_transition' => 'This action is not valid for the current document state.',
    'invalid_party' => 'Select an active party with the required customer or supplier role.',
    'invalid_invoice' => 'The allocation invoice, party, currency, balance, or direction is not valid.',
    'duplicate_allocation' => 'An invoice may only occur once in an allocation group.',
    'historical_not_supported' => 'This report is a current-state report; historical dates are not supported.',
    'export_too_large' => 'The report exceeds the 50000-row safety limit. Narrow the filters.',
    'duplicate_instrument' => 'An instrument with this number, kind, and direction already exists.',
    'scan_too_large' => 'The source exceeds the supported 50000 open-invoice scan limit.',
];
