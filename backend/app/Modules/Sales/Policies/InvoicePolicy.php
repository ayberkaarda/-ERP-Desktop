<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class InvoicePolicy extends SalesPolicy
{
    public function issue(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'issue');
    }

    public function reverse(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'reverse');
    }

    protected function resource(): string
    {
        return 'invoices';
    }
}
