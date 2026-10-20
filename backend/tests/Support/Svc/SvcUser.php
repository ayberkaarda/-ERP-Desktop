<?php

declare(strict_types=1);

namespace Tests\Support\Svc;

use Illuminate\Auth\GenericUser;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Support\Facades\Gate;

/**
 * Minimal authorizable user (spatie's Gate::before hook requires the interface).
 */
final class SvcUser extends GenericUser implements Authorizable
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
