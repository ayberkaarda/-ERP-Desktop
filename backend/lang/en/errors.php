<?php

declare(strict_types=1);

return [
    'validation_error' => 'The given data was invalid.',
    'unauthenticated' => 'Authentication is required.',
    'forbidden' => 'You are not allowed to perform this action.',
    'not_found' => 'The requested resource was not found.',
    'method_not_allowed' => 'This method is not allowed for the requested resource.',
    'too_many_attempts' => 'Too many attempts. Please try again later.',
    'http_error' => 'The request could not be processed.',
    'server_error' => 'An unexpected error occurred.',
    'version_conflict' => 'The record was changed by someone else. Reload it and try again.',
    'idempotency_key_required' => 'An Idempotency-Key header is required for this request.',
    'idempotency_key_reused' => 'This idempotency key was already used with a different request.',
    'idempotency_in_progress' => 'A request with this idempotency key is still being processed.',
    'company_required' => 'An active company must be selected.',
    'company_forbidden' => 'You do not have access to this company.',
    'two_factor_required' => 'Two-factor authentication is required.',
    'invalid_two_factor_code' => 'The two-factor code is invalid.',
    'password_change_required' => 'You must change your password before continuing.',
    'user_deactivated' => 'This user account is deactivated.',
    'invalid_state_transition' => 'This status change is not allowed.',
    'approval_required' => 'This document requires approval first.',
    'file_too_large' => 'The file is too large.',
    'unsupported_file_type' => 'This file type is not supported.',
];
