<?php

declare(strict_types=1);

namespace App\Core\Company;

use Closure;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Spatie\Permission\PermissionRegistrar;

/**
 * Active company for the current request or job. Bound as a scoped singleton.
 */
final class CompanyContext
{
    private ?string $companyId = null;

    public function __construct(private readonly ?PermissionRegistrar $permissions = null) {}

    public function set(string $companyId): void
    {
        if (! Str::isUuid($companyId)) {
            throw new InvalidArgumentException('Company id must be a UUID.');
        }

        $this->apply($companyId);
    }

    /**
     * @throws MissingCompanyContext
     */
    public function id(): string
    {
        return $this->companyId ?? throw new MissingCompanyContext;
    }

    public function idOrNull(): ?string
    {
        return $this->companyId;
    }

    public function has(): bool
    {
        return $this->companyId !== null;
    }

    public function clear(): void
    {
        $this->apply(null);
    }

    /**
     * Runs $fn with another active company and restores the previous one afterwards.
     *
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public function runAs(string $companyId, Closure $fn): mixed
    {
        $previous = $this->companyId;
        $this->set($companyId);

        try {
            return $fn();
        } finally {
            $this->apply($previous);
        }
    }

    private function apply(?string $companyId): void
    {
        $this->companyId = $companyId;
        // Spatie teams are companies, so permission checks follow the active company.
        $this->permissions?->setPermissionsTeamId($companyId);
    }
}
