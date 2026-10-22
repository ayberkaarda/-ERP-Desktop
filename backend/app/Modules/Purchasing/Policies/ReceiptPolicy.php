<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/** cancel of a draft is an edit; of a posted receipt a reversal (checked on the locked record). */
final class ReceiptPolicy extends PurchasingPolicy
{
    public function post(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'post');
    }

    public function reverse(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'reverse');
    }

    /** Either may start a cancel; the service decides which applies to the receipt's state. */
    public function cancel(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'update') || $this->allowed($user, $doc, 'reverse');
    }

    protected function resource(): string
    {
        return 'receipts';
    }
}
