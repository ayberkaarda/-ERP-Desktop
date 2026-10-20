<?php

declare(strict_types=1);

namespace App\Modules\Files\Contracts;

/**
 * Marks a model that files may be attached to (no native return types: Eloquent Model declares these untyped). Implemented with the HasAttachments trait.
 */
interface Attachable
{
    /** @return string */
    public function getMorphClass();

    /** @return mixed */
    public function getKey();
}
