<?php

declare(strict_types=1);

namespace App\Core\Support;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Support\Str;

/**
 * UUIDv7 primary keys. Generated in PHP so the model knows its key before insert
 * (clients may also supply one); the uuidv7() column default covers raw inserts.
 */
trait HasUuid7
{
    use HasUuids;

    public function newUniqueId(): string
    {
        return (string) Str::uuid7();
    }

    public function getKeyType(): string
    {
        return 'string';
    }

    public function getIncrementing(): bool
    {
        return false;
    }
}
