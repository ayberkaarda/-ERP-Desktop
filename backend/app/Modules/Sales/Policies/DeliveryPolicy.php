<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/** Cancelling a posted delivery reverses its stock: reverse; a draft is cancelled with update. */
final class DeliveryPolicy extends SalesPolicy
{
    public function post(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'post');
    }

    /** Draft cancel (update) or reversal of a posted delivery (reverse); the controller picks by status. */
    public function cancel(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'update') || $this->allowed($user, $doc, 'reverse');
    }

    public function reverse(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'reverse');
    }

    protected function resource(): string
    {
        return 'deliveries';
    }
}
