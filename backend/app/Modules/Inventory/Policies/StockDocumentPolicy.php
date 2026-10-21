<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Policies;

use App\Models\User;
use App\Modules\Inventory\Models\StockDocument;

final class StockDocumentPolicy extends InventoryPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.documents.view');
    }

    public function view(User $user, ?StockDocument $document = null): bool
    {
        return $this->allowed($user, $document, 'inventory.documents.view');
    }

    public function export(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.documents.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.documents.create');
    }

    public function update(User $user, ?StockDocument $document = null): bool
    {
        return $this->allowed($user, $document, 'inventory.documents.create');
    }

    public function delete(User $user, ?StockDocument $document = null): bool
    {
        return $this->allowed($user, $document, 'inventory.documents.create');
    }

    public function post(User $user, ?StockDocument $document = null): bool
    {
        return $this->allowed($user, $document, 'inventory.documents.post');
    }

    public function reverse(User $user, ?StockDocument $document = null): bool
    {
        return $this->allowed($user, $document, 'inventory.documents.reverse');
    }

    /** Issuing from expired lots, on top of post. */
    public function issueExpired(User $user): bool
    {
        return $this->allowed($user, null, 'inventory.documents.issue_expired');
    }
}
