<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;

/**
 * Row of P1's global fixture table sync_fixture_tags (no company_id, hard deletes only).
 *
 * @property string $id
 * @property string $name
 */
final class GlobalTag extends Model
{
    use HasUuid7;

    public $timestamps = false;

    protected $table = 'sync_fixture_tags';

    protected $guarded = [];
}
