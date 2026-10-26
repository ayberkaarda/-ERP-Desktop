<?php

declare(strict_types=1);

return [
    'duplicate_resource' => 'A resource may appear only once per request.',
    'resource_unsupported' => 'This resource is not available for sync.',
    'cursor_invalid' => 'The cursor is malformed or was not issued by this server.',
    'depends_on_forward' => 'depends_on may only name mutations sent earlier.',
    'depends_on_unknown' => 'depends_on names a mutation the server does not know.',
    'base_version_create' => 'base_version must be null for create.',
    'base_version_required' => 'base_version is required for this operation.',
    'changed_fields_empty' => 'changed_fields must be empty for create and delete.',
    'payload_empty' => 'The payload of a delete must be empty.',
    'changed_fields_required' => 'changed_fields and payload are required for update and action.',
    'action_mismatch' => 'action is required for op action and not allowed otherwise.',
    'payload_version' => 'The payload must not contain version.',
];
