<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

/** submit and cancel are edits of the request; its approval runs through the workflow. */
final class RequestPolicy extends PurchasingPolicy
{
    protected function resource(): string
    {
        return 'requests';
    }
}
