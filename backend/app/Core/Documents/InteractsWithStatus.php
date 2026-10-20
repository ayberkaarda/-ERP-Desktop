<?php

declare(strict_types=1);

namespace App\Core\Documents;

use BackedEnum;
use Illuminate\Database\Eloquent\Model;

/**
 * Default HasStatus implementation over a `status` column (string or backed enum cast).
 *
 * @mixin Model
 */
trait InteractsWithStatus
{
    public function statusColumn(): string
    {
        return 'status';
    }

    public function currentStatus(): string
    {
        $value = $this->getAttribute($this->statusColumn());

        if ($value instanceof BackedEnum) {
            return (string) $value->value;
        }

        return is_scalar($value) ? (string) $value : '';
    }

    public function applyStatus(string $status): void
    {
        $this->setAttribute($this->statusColumn(), $status);
    }
}
