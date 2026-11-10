<?php

declare(strict_types=1);

namespace App\Core\Sync\Contracts;

use App\Core\Sync\Mutation;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

/**
 * A writer whose update payload carries a field the activity log does not track (an embedded
 * collection the editor resends on every save, such as a payment's allocations). Such a field
 * counts as changed in every stale-base decision, so an edit of another field would conflict
 * just for carrying it. Before the conflict decision of an update the push hands the mutation
 * to the writer, which drops every such field whose value equals what the target holds now:
 * resending the same value is not an edit, so it neither conflicts nor is rewritten. A value
 * that differs stays in the mutation, and a stale base then conflicts as before.
 *
 * The writer prunes only what its REST endpoint would accept as sent (shape and types), so a
 * pruned write never skips a validation answer, and only when $user may read everything the
 * comparison reads, so the probe tells nothing the user could not read. The idempotency
 * fingerprint and the stored result are of the mutation as sent, and a replay never prunes.
 */
interface PrunesUnchangedFields
{
    /** The mutation without its unchanged untracked fields (Mutation::without), or as is. */
    public function withoutUnchanged(Authenticatable $user, Mutation $mutation, Model $target): Mutation;
}
