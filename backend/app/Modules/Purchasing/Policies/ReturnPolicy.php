<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class ReturnPolicy extends PurchasingPolicy
{
    public function approve(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'approve');
    }

    public function ship(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'ship');
    }

    public function debit(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'debit');
    }

    protected function resource(): string
    {
        return 'returns';
    }
}
