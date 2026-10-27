<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Carbon;

/**
 * Visibility generations (SYNC-PROTOCOL "Görünürlük nesli").
 *
 * In D1 rows are visible per resource (manifest `requires` + company scope + the adapter
 * query), so what a user sees of a resource is a function of whether the requirement holds.
 * The state is observed at three points: every manifest and pull, and every access change
 * (Identity AccessChanged -> VisibilityRefresh, inside the transaction of the change); when it
 * differs from the stored one the generation of (user, company, resource) goes up by one. So a
 * role change that hides a resource raises the generation at once, and showing it again raises
 * it once more, even when no sync runs in between: any cursor issued before carries an older
 * generation and is reset. Unchanged visibility keeps the generation, so the row stream a
 * cursor walks is the same stream. A lost membership (MembershipRevoked, after commit)
 * additionally raises every generation of the user in that company (invalidate()).
 */
final readonly class Visibility
{
    public function __construct(private ConnectionInterface $db) {}

    /**
     * Current generation after recording the observed state.
     */
    public function observe(string $userId, string $companyId, string $resource, bool $visible): int
    {
        $state = $visible ? 'visible' : 'hidden';
        $row = $this->db->table('sync_visibility_generations')
            ->where('user_id', $userId)
            ->where('company_id', $companyId)
            ->where('resource', $resource)
            ->first(['generation', 'state']);

        if (is_object($row) && ($row->state ?? null) === $state) {
            return (int) $row->generation;
        }

        // First observation starts at 0; a change bumps atomically against concurrent requests.
        $result = $this->db->selectOne(
            'INSERT INTO sync_visibility_generations (user_id, company_id, resource, generation, state, updated_at)
             VALUES (?, ?, ?, 0, ?, ?)
             ON CONFLICT (user_id, company_id, resource) DO UPDATE SET
                generation = sync_visibility_generations.generation
                    + CASE WHEN sync_visibility_generations.state <> EXCLUDED.state THEN 1 ELSE 0 END,
                state = EXCLUDED.state,
                updated_at = EXCLUDED.updated_at
             RETURNING generation',
            [$userId, $companyId, $resource, $state, Carbon::now()],
        );

        $values = is_object($result) ? get_object_vars($result) : [];

        return is_numeric($values['generation'] ?? null) ? (int) $values['generation'] : 0;
    }

    /**
     * Every resource of the user in the company changed visibility (membership revoked): all
     * cursors issued so far are reset at their next pull, even when access comes back before
     * that pull observes anything.
     */
    public function invalidate(string $userId, string $companyId): void
    {
        $this->db->table('sync_visibility_generations')
            ->where('user_id', $userId)
            ->where('company_id', $companyId)
            ->update(['generation' => $this->db->raw('generation + 1'), 'updated_at' => Carbon::now()]);
    }
}
