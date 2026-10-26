<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Policies;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/** send, quote entry and cancel are edits; award needs purchasing.rfqs.award. */
final class RfqPolicy extends PurchasingPolicy
{
    public function award(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'award');
    }

    protected function resource(): string
    {
        return 'rfqs';
    }
}
