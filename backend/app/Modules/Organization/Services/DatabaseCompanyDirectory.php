<?php

declare(strict_types=1);

namespace App\Modules\Organization\Services;

use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Models\Company;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Carbon;

final class DatabaseCompanyDirectory implements CompanyDirectory
{
    private const string MEMBERS = 'company_user';

    public function __construct(private readonly ConnectionInterface $db) {}

    public function isActive(string $companyId): bool
    {
        return Company::query()->whereKey($companyId)->where('is_active', true)->exists();
    }

    public function isActiveMember(string $userId, string $companyId): bool
    {
        return $this->db->table(self::MEMBERS)
            ->join('companies', 'companies.id', '=', self::MEMBERS.'.company_id')
            ->where(self::MEMBERS.'.user_id', $userId)
            ->where(self::MEMBERS.'.company_id', $companyId)
            ->where(self::MEMBERS.'.is_active', true)
            ->where('companies.is_active', true)
            ->whereNull('companies.deleted_at')
            ->exists();
    }

    public function hasMembership(string $userId, string $companyId): bool
    {
        return $this->db->table(self::MEMBERS)->where('user_id', $userId)->where('company_id', $companyId)->exists();
    }

    public function companiesFor(string $userId): array
    {
        $rows = Company::query()
            ->where('is_active', true)
            ->whereIn('id', fn (QueryBuilder $q) => $q->select('company_id')->from(self::MEMBERS)
                ->where('user_id', $userId)->where('is_active', true))
            ->orderBy('name')
            ->get(['id', 'name']);

        return $this->pairs($rows->all());
    }

    public function allActiveCompanies(): array
    {
        return $this->pairs(Company::query()->where('is_active', true)->orderBy('name')->get(['id', 'name'])->all());
    }

    public function membershipCompanyIds(string $userId): array
    {
        /** @var list<string> $ids */
        $ids = $this->db->table(self::MEMBERS)->where('user_id', $userId)->pluck('company_id')->map(fn ($id): string => (string) $id)->values()->all();

        return $ids;
    }

    public function setMembership(string $userId, string $companyId, bool $active): void
    {
        $now = Carbon::now();

        $this->db->table(self::MEMBERS)->upsert(
            [['company_id' => $companyId, 'user_id' => $userId, 'is_active' => $active, 'created_at' => $now, 'updated_at' => $now]],
            ['company_id', 'user_id'],
            ['is_active', 'updated_at'],
        );
    }

    public function constrainToMembers(Builder $query, string $companyId, string $userKeyColumn, bool $activeOnly = false): void
    {
        $query->whereIn($query->qualifyColumn($userKeyColumn), function (QueryBuilder $q) use ($companyId, $activeOnly): void {
            $q->select('user_id')->from(self::MEMBERS)->where('company_id', $companyId);

            if ($activeOnly) {
                $q->where('is_active', true);
            }
        });
    }

    /**
     * @param  array<int, Company>  $companies
     * @return list<array{id: string, name: string}>
     */
    private function pairs(array $companies): array
    {
        return array_values(array_map(
            static fn (Company $c): array => ['id' => $c->id, 'name' => $c->name],
            $companies,
        ));
    }
}
