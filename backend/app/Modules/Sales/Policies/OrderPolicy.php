<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/** confirm, revise and close need approve; cancel is an edit. */
final class OrderPolicy extends SalesPolicy
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
