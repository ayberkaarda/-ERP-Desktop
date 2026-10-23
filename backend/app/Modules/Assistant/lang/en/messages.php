<?php

declare(strict_types=1);

return [
    'new_conversation' => 'New conversation',
    'approval_reason' => 'Review the proposed fields. Approval creates a draft only.',
    'failed' => 'The assistant could not complete this message. Try again later.',
    'interrupted' => 'This message was interrupted.',
    'rejected' => 'You rejected this draft.',
    'errors' => [
        'ASSISTANT_DISABLED' => 'The assistant is disabled.',
        'ASSISTANT_NOT_CONFIGURED' => 'Configure the assistant provider and model.',
        'FORBIDDEN' => 'You do not have permission for this assistant operation.',
        'ASSISTANT_BUSY' => 'Another message is processing.',
        'ASSISTANT_APPROVAL_PENDING' => 'Resolve the pending draft approvals first.',
        'ASSISTANT_BUDGET_EXCEEDED' => 'Your daily assistant token budget is exhausted.',
        'ASSISTANT_TURN_LIMIT' => 'This assistant turn reached its token or step limit.',
        'ASSISTANT_REQUEST_CONFLICT' => 'This request ID was already used for another message.',
        'ASSISTANT_TOOL_UNAVAILABLE' => 'This draft tool is no longer available to you.',
        'ASSISTANT_TOOL_LIMIT' => 'The requested tool data exceeds the allowed limit.',
        'ASSISTANT_APPROVAL_RESOLVED' => 'This approval has already been resolved.',
    ],
];
