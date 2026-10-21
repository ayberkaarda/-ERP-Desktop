<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Company\CompanyContext;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Small helpers shared by catalog services: domain validation errors and unique-index races.
 */
final class CatalogRules
{
    /**
     * @param  array<string, string|int|float>  $replace
     *
     * @throws ValidationException
     */
    public static function fail(string $field, string $key, array $replace = []): never
    {
        throw ValidationException::withMessages([$field => [self::message($key, $replace)]]);
    }

    /**
     * @param  array<string, string|int|float>  $replace
     */
    public static function message(string $key, array $replace = []): string
    {
        $message = __("catalog::messages.{$key}", $replace);

        return is_string($message) ? $message : $key;
    }

    /**
     * All ids are live rows of the active company; they stay FOR SHARE locked until commit, so a
     * concurrent delete (which locks the row FOR UPDATE and then checks usage) either sees the new
     * reference or has already removed the row and this check fails.
     *
     * @param  class-string<Model>  $class
     * @param  list<string|null>  $ids
     */
    public static function sharedExists(string $class, array $ids): bool
    {
        $ids = array_values(array_unique(array_filter($ids, fn (?string $id): bool => $id !== null)));

        if ($ids === []) {
            return true;
        }

        if (array_filter($ids, fn (string $id): bool => ! Str::isUuid($id)) !== []) {
            return false;
        }

        $key = (new $class)->getKeyName();
        // Rows, not count(*): PostgreSQL refuses FOR SHARE with aggregates.
        $found = $class::query()->whereIn($key, $ids)->sharedLock()->pluck($key)->all();

        return count($found) === count($ids);
    }

    /**
     * Locks the row FOR UPDATE and checks the version the client saw, so a delete never removes a
     * newer version than the one it was based on.
     *
     * @template TModel of Model
     *
     * @param  TModel  $model
     * @return TModel
     */
    public static function lockVersion(Model $model, ?int $version): Model
    {
        $locked = $model->newQuery()->whereKey($model->getKey())->lockForUpdate()->firstOrFail();

        if ($version !== null && method_exists($locked, 'assertVersion')) {
            $locked->assertVersion($version);
        }

        return $locked;
    }

    /**
     * Transaction-scoped advisory lock per active company and topic (e.g. "units").
     */
    public static function lock(string $topic): void
    {
        DB::select('select pg_advisory_xact_lock(hashtext(?))', ['catalog.'.$topic.'.'.app(CompanyContext::class)->id()]);
    }

    /**
     * Runs $callback in a transaction; a violated unique index listed in $indexes becomes a 422 on its field.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @param  array<string, string>  $indexes  index name => field
     * @return T
     */
    public static function transaction(Closure $callback, array $indexes = []): mixed
    {
        try {
            return DB::transaction($callback);
        } catch (UniqueConstraintViolationException $e) {
            foreach ($indexes as $index => $field) {
                if (str_contains($e->getMessage(), $index)) {
                    $message = __('validation.unique', ['attribute' => str_replace('_', ' ', $field)]);

                    throw ValidationException::withMessages([$field => [is_string($message) ? $message : 'unique']]);
                }
            }

            throw $e;
        }
    }
}
