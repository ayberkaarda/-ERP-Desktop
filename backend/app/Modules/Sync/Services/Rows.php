<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Contracts\SyncResource;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;

/**
 * REST API Resource JSON of sync rows, exactly as the REST endpoint renders it (same Resource
 * class, manifest embeds loaded), normalised through JSON so nested resources are plain arrays.
 */
final readonly class Rows
{
    public function __construct(private Request $request) {}

    /**
     * Current row of the resource inside the company, or null when the adapter query does
     * not return it (other company, soft deleted).
     *
     * @return array<string, mixed>|null
     */
    public function current(SyncResource $resource, string $companyId, string $id): ?array
    {
        $table = $resource->table();
        $model = $resource->query($companyId)->where("{$table}.id", $id)->first();

        return $model instanceof Model ? $this->render($resource, $model) : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function render(SyncResource $resource, Model $model): array
    {
        $missing = array_values(array_filter(
            array_map(static fn (string $embed): string => self::relation($model, $embed), $resource->embeds()),
            static fn (string $relation): bool => ! $model->relationLoaded($relation),
        ));

        if ($missing !== []) {
            $model->load($missing);
        }

        $class = $resource->resourceClass();
        /** @var JsonResource $json */
        $json = new $class($model);

        return self::normalise($json->resolve($this->request));
    }

    /**
     * Relation behind a manifest embed. Embeds are named by their JSON key (base_unit); the
     * Eloquent relation may be the camel-case method (baseUnit).
     */
    private static function relation(Model $model, string $embed): string
    {
        return $model->isRelation($embed) ? $embed : Str::camel($embed);
    }

    /**
     * @return array<string, mixed>
     */
    public static function normalise(mixed $value): array
    {
        $decoded = json_decode(json_encode($value, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), true, 512, JSON_THROW_ON_ERROR);

        /** @var array<string, mixed> */
        return is_array($decoded) ? $decoded : [];
    }
}
