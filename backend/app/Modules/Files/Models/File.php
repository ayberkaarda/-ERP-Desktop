<?php

declare(strict_types=1);

namespace App\Modules\Files\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $company_id
 * @property string $disk
 * @property string $path
 * @property string $original_name
 * @property string $mime
 * @property int $size
 * @property string $sha256
 * @property string|null $uploaded_by
 * @property string|null $attachable_type
 * @property string|null $attachable_id
 * @property Carbon $created_at
 */
class File extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use SoftDeletes;

    protected $table = 'files';

    protected $guarded = [];

    /**
     * @return MorphTo<Model, $this>
     */
    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['size' => 'integer'];
    }
}
