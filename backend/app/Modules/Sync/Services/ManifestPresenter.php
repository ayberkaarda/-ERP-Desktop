<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Models\User;
use App\Modules\Sync\Manifest\WriteOp;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;

/**
 * GET /sync/manifest body (manifest.response.schema.json): the offline manifest filtered by
 * the user's permissions in the active company. Every listed resource's visibility is
 * observed, so a resource hidden by a role change raises its generation here already.
 */
final readonly class ManifestPresenter
{
    public function __construct(
        private ManifestService $manifests,
        private Visibility $visibility,
        private ConnectionInterface $db,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function present(User $user, string $companyId, ?string $tokenId): array
    {
        $config = $this->manifests->config();
        $manifest = $this->manifests->manifest();
        $granted = $this->manifests->granted($user, $companyId);
        $resources = [];

        foreach ($manifest->resources as $resource) {
            if (! $this->manifests->served($resource)) {
                continue;
            }

            $visible = $resource->requires->satisfiedBy($granted);
            $generation = $resource->isPull()
                ? $this->visibility->observe($user->id, $companyId, $resource->name, $visible)
                : 0;

            if (! $visible) {
                continue;
            }

            $resources[] = [
                'resource' => $resource->name,
                'scope' => $resource->scope->value,
                'read' => $resource->read,
                'source' => $resource->source,
                'window_days' => $resource->windowDays,
                'writable' => array_map(static fn (WriteOp $op): string => $op->key(), $this->manifests->writableOps($resource, $granted)),
                'visibility_generation' => $generation,
            ];
        }

        $permissions = array_map('strval', array_keys($granted));
        sort($permissions);

        return [
            'schema_version' => $config->schemaVersion,
            'min_schema_version' => $config->minSchemaVersion,
            'offline_manifest_version' => $manifest->version,
            'server_time' => Carbon::now()->toIso8601String(),
            'company_id' => $companyId,
            'user_id' => $user->id,
            'device_id' => $this->deviceId($tokenId),
            'permissions' => $permissions,
            'resources' => $resources,
            'online_only' => $this->manifests->onlineOnly($granted),
            'limits' => [
                'pull_resources_max' => $config->pullResourcesMax,
                'pull_page_default' => $config->pullPageDefault,
                'pull_page_max' => $config->pullPageMax,
                'push_batch_max' => $config->pushBatchMax,
                'tombstone_retention_days' => $config->tombstoneRetentionDays,
                'idempotency_retention_days' => $config->idempotencyRetentionDays,
            ],
        ];
    }

    private function deviceId(?string $tokenId): ?string
    {
        $id = $tokenId === null ? null : $this->db->table('user_devices')->where('token_id', $tokenId)->value('id');

        return is_string($id) ? $id : null;
    }
}
