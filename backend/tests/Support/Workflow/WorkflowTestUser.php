<?php

declare(strict_types=1);

namespace Tests\Support\Workflow;

use Illuminate\Auth\GenericUser;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Support\Facades\Gate;

/**
 * Minimal in-memory user for Workflow tests; avoids depending on the identity module's users table.
 */
final class WorkflowTestUser extends GenericUser implements Authorizable
{
    /**
     * @param  iterable<mixed>|string  $abilities
     * @param  array<mixed>|mixed  $arguments
     */
    public function can($abilities, $arguments = []): bool
    {
        return Gate::forUser($this)->check($abilities, $arguments);
    }
}
