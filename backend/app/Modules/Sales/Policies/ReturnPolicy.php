<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class ReturnPolicy extends SalesPolicy
{
    public function approve(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'approve');
    }

    public function receive(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'receive');
    }

    public function credit(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'credit');
    }

    protected function resource(): string
    {
        return 'returns';
    }
}
