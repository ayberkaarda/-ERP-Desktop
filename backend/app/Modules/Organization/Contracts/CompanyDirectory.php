<?php

declare(strict_types=1);

namespace App\Modules\Organization\Contracts;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * What other modules may know about companies and memberships.
 */
interface CompanyDirectory
{
    /** Company exists, is active and not deleted. */
    public function isActive(string $companyId): bool;

    public function isActiveMember(string $userId, string $companyId): bool;

    /** Membership row exists, active or not. */
    public function hasMembership(string $userId, string $companyId): bool;

    /**
     * Active companies the user is an active member of.
     *
     * @return list<array{id: string, name: string}>
     */
    public function companiesFor(string $userId): array;

    /**
     * @return list<array{id: string, name: string}>
     */
    public function allActiveCompanies(): array;

    /**
     * Ids of every company with a membership row for the user, active or not.
     *
     * @return list<string>
     */
    public function membershipCompanyIds(string $userId): array;

    public function setMembership(string $userId, string $companyId, bool $active): void;

    /**
     * Limits a query on users (or rows keyed by user) to members of the company.
     *
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     */
    public function constrainToMembers(Builder $query, string $companyId, string $userKeyColumn, bool $activeOnly = false): void;
}
