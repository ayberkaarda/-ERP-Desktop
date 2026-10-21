<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * jsonb object column <-> associative array; an empty array is stored as {} (never []).
 *
 * @implements CastsAttributes<array<string, mixed>, mixed>
 */
final class JsonObjectCast implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : null;

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        return json_encode((object) (is_array($value) ? $value : []), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    }
}
