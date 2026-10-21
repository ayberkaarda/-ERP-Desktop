<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Policies;

use App\Models\User;
use App\Modules\Accounting\Models\JournalEntry;

final class JournalEntryPolicy extends AccountingPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.entries.view');
    }

    public function view(User $user, ?JournalEntry $entry = null): bool
    {
        return $this->allowed($user, $entry, 'accounting.entries.view');
    }

    public function export(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.entries.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.entries.create');
    }

    public function update(User $user, ?JournalEntry $entry = null): bool
    {
        return $this->allowed($user, $entry, 'accounting.entries.create');
    }

    public function delete(User $user, ?JournalEntry $entry = null): bool
    {
        return $this->allowed($user, $entry, 'accounting.entries.create');
    }

    public function post(User $user, ?JournalEntry $entry = null): bool
    {
        return $this->allowed($user, $entry, 'accounting.entries.post');
    }

    /** Booking into a soft-closed period on top of post. */
    public function postSoftClosed(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.entries.post_soft_closed');
    }

    public function reverse(User $user, ?JournalEntry $entry = null): bool
    {
        return $this->allowed($user, $entry, 'accounting.entries.reverse');
    }

    public function revalue(User $user): bool
    {
        return $this->allowed($user, null, 'accounting.revaluation.run');
    }
}
