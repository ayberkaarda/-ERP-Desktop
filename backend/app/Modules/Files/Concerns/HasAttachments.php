<?php

declare(strict_types=1);

namespace App\Modules\Files\Concerns;

use App\Modules\Files\Models\File;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * @mixin Model
 */
trait HasAttachments
{
    /**
     * @return MorphMany<File, $this>
     */
    public function attachments(): MorphMany
    {
        return $this->morphMany(File::class, 'attachable');
    }
}
