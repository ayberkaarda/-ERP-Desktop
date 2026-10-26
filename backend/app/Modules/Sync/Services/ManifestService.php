<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\SyncConfig;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Sync\Manifest\Manifest;
use App\Modules\Sync\Manifest\ManifestResource;
use App\Modules\Sync\Manifest\WriteOp;
use Illuminate\Contracts\Config\Repository;

/**
 * The offline manifest (config sync.manifest_path) and what of it a user may use in a company.
 *
 * A pull resource is served only when a module adapter is tagged for it; snapshot resources
 * are read from their own REST endpoints and need none. A write op is offered only when the
 * resource has a writer.
 */
final class ManifestService
{
    /** @var array<string, Manifest> parsed files by path and mtime */
    private static array $parsed = [];

    public function __construct(
        private readonly Repository $config,
        private readonly Adapters $adapters,
        private readonly CompanyAuthorizer $authorizer,
    ) {}

    public function config(): SyncConfig
    {
        return SyncConfig::fromConfig($this->config);
    }

    public function manifest(): Manifest
    {
        $path = $this->config()->manifestPath;
        $key = $path.'@'.(is_file($path) ? (string) filemtime($path).':'.(string) filesize($path) : 'missing');

        return self::$parsed[$key] ??= Manifest::fromFile($path);
    }

    /**
     * Effective permissions of the user in the company, as a set.
     *
     * @return array<string, true>
     */
    public function granted(User $user, string $companyId): array
    {
        $permissions = $this->authorizer->permissionsByCompany($user)[$companyId] ?? [];

        return array_fill_keys($permissions, true);
    }

    /**
     * Whether the resource exists for the server: in the manifest and, for pull streams, backed
     * by an adapter.
     */
    public function served(ManifestResource $resource): bool
    {
        return ! $resource->isPull() || $this->adapters->resource($resource->name) !== null;
    }

    /**
     * @param  array<string, true>  $granted
     */
    public function visible(ManifestResource $resource, array $granted): bool
    {
        return $this->served($resource) && $resource->requires->satisfiedBy($granted);
    }

    /**
     * Write ops of the resource the user may queue offline.
     *
     * @param  array<string, true>  $granted
     * @return list<WriteOp>
     */
    public function writableOps(ManifestResource $resource, array $granted): array
    {
        if ($resource->write === null || ! $this->visible($resource, $granted)
            || $this->adapters->writer($resource->name) === null) {
            return [];
        }

        return array_values(array_filter(
            $resource->write->ops,
            static fn (WriteOp $op): bool => $op->requires->satisfiedBy($granted),
        ));
    }

    /**
     * ONLINE_ONLY action keys shown to the user: an entry is listed when one of its routes
     * belongs to a resource the user sees, or when none of its routes belongs to a manifest
     * resource at all (treasury, e-documents, accounting: their permission is checked by the
     * REST endpoint itself). The list is a UI label, never a security boundary.
     *
     * @param  array<string, true>  $granted
     * @return list<string>
     */
    public function onlineOnly(array $granted): array
    {
        $manifest = $this->manifest();
        $actions = [];

        foreach ($manifest->onlineOnly as $entry) {
            $owned = false;
            $seen = false;

            foreach ($entry['routes'] as $route) {
                $path = (string) preg_replace('/^[A-Z]+ /', '', $route);

                foreach ($manifest->resources as $resource) {
                    if ($resource->path !== '' && ($path === $resource->path || str_starts_with($path, $resource->path.'/'))) {
                        $owned = true;
                        $seen = $seen || $this->visible($resource, $granted);
                    }
                }
            }

            if ($seen || ! $owned) {
                $actions[$entry['action']] = true;
            }
        }

        return array_keys($actions);
    }
}
