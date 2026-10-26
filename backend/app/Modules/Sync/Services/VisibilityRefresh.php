<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Models\User;
use App\Modules\Identity\Events\AccessChanged;
use Illuminate\Database\ConnectionInterface;

/**
 * Listener of Identity's AccessChanged: re-observes, with the permissions as they are now, every
 * pull resource of the affected (user, company) pairs that already have generations. It runs in
 * the transaction of the access change, so a resource hidden and shown again between two syncs
 * still goes up twice, and a rolled back change leaves the generations as they were.
 *
 * Pairs without any generation are skipped: that user never synced in that company, so there is
 * no cursor to reset, and its first manifest or pull records the state. A change that leaves a
 * resource's visibility as it was keeps its generation (Visibility::observe).
 */
final readonly class VisibilityRefresh
{
    public function __construct(
        private ConnectionInterface $db,
        private ManifestService $manifests,
        private Visibility $visibility,
    ) {}

    public function handle(AccessChanged $event): void
    {
        if ($event->userIds === []) {
            return;
        }

        $pairs = $this->db->table('sync_visibility_generations')
            ->whereIn('user_id', $event->userIds)
            ->when($event->companyId !== null, fn ($q) => $q->where('company_id', $event->companyId))
            ->distinct()
            ->orderBy('user_id')
            ->orderBy('company_id')
            ->get(['user_id', 'company_id']);

        $resources = array_values(array_filter(
            $this->manifests->manifest()->resources,
            fn ($resource): bool => $resource->isPull() && $this->manifests->served($resource),
        ));

        foreach ($pairs->groupBy('user_id') as $userId => $rows) {
            $user = User::query()->find((string) $userId);

            foreach ($rows as $row) {
                $companyId = (string) $row->company_id;
                $granted = $user instanceof User ? $this->manifests->granted($user, $companyId) : [];

                foreach ($resources as $resource) {
                    $this->visibility->observe((string) $userId, $companyId, $resource->name, $resource->requires->satisfiedBy($granted));
                }
            }
        }
    }
}
