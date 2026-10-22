<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/** submit, revise and close need approve; send and cancel are edits. */
final class OrderPolicy extends PurchasingPolicy
{
    public function approve(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'approve');
    }

    protected function resource(): string
    {
        return 'orders';
    }
}
