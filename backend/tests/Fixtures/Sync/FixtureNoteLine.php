<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;

/**
 * Line of a FixtureNote; not a resource of its own, it only moves its note's sync position.
 *
 * @property string $id
 * @property string $note_id
 * @property int $position
 * @property string $body
 */
final class FixtureNoteLine extends Model
{
    use HasUuid7;

    public $timestamps = false;

    protected $table = 'sync_fixture_note_lines';

    protected $guarded = [];
}
