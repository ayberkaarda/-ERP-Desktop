<?php

declare(strict_types=1);

namespace App\Modules\Identity\Broadcasting;

use App\Core\Company\MembershipChecker;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * presence-company.{id}.online: members of the company; exposes only id and name.
 */
final class CompanyPresenceChannel
{
    public function __construct(private readonly MembershipChecker $membership) {}

    /**
     * @return array{id: string, name: string}|false
     */
    public function join(mixed $user, string $id): array|false
    {
        if (! $user instanceof User || ! Str::isUuid($id) || ! $this->membership->isMember($user->id, $id)) {
            return false;
        }

        return ['id' => $user->id, 'name' => $user->name];
    }
}
