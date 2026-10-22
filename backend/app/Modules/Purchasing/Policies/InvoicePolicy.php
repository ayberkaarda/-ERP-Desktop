<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class InvoicePolicy extends PurchasingPolicy
{
    public function book(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'book');
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
