<?php

declare(strict_types=1);

namespace App\Core\Documents;

use BackedEnum;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Central place for document status changes: lock, validate, persist, then announce after commit.
 */
abstract class StateMachine
{
    /**
     * Allowed moves keyed by source status value.
     *
     * @return array<string, list<string>>
     */
    abstract protected function transitions(): array;

    /**
     * @return list<string>
     */
    public function allowedFrom(string|BackedEnum $from): array
    {
        return $this->transitions()[self::value($from)] ?? [];
    }

    public function can(string|BackedEnum $from, string|BackedEnum $to): bool
    {
        return in_array(self::value($to), $this->allowedFrom($from), true);
    }

    /**
     * @template TModel of Model&HasStatus
     *
     * @param  TModel  $model
     * @return TModel
     *
     * @throws InvalidStateTransition
     */
    public function transition(Model&HasStatus $model, string|BackedEnum $to, ?Authenticatable $actor = null): Model
    {
        $to = self::value($to);

        return $model->getConnection()->transaction(function () use ($model, $to, $actor): Model {
            $from = $this->lockAndReload($model);

            if (! $this->can($from, $to)) {
                throw new InvalidStateTransition($from, $to);
            }

            $this->beforeTransition($model, $from, $to, $actor);
            $model->applyStatus($to);
            $model->save();
            $this->afterTransition($model, $from, $to, $actor);

            $actorId = $actor?->getAuthIdentifier();

            event(new DocumentTransitioned(
                $model,
                $model->getMorphClass(),
                $from,
                $to,
                is_string($actorId) || is_int($actorId) ? (string) $actorId : null,
            ));

            return $model;
        });
    }

    /**
     * Guards and side effects inside the transaction (e.g. assign a number on post).
     */
    protected function beforeTransition(Model&HasStatus $model, string $from, string $to, ?Authenticatable $actor): void {}

    protected function afterTransition(Model&HasStatus $model, string $from, string $to, ?Authenticatable $actor): void {}

    /**
     * Re-reads the full row under a row lock through the scoped query, so two transitions
     * serialize, a row of another company is invisible, and guards never see stale fields.
     *
     * @throws ModelNotFoundException<Model>
     * @throws VersionConflictException
     */
    private function lockAndReload(Model&HasStatus $model): string
    {
        if (! $model->exists) {
            return $model->currentStatus();
        }

        $locked = $model->newQuery()->whereKey($model->getKey())->lockForUpdate()->first();

        if (! $locked instanceof Model) {
            throw (new ModelNotFoundException)->setModel($model::class, [$model->getKey()]);
        }

        if (in_array(HasVersion::class, class_uses_recursive($model), true)) {
            $loaded = $model->getOriginal('version');
            $current = $locked->getAttributes()['version'] ?? null;
            $loaded = is_numeric($loaded) ? (int) $loaded : 0;
            $current = is_numeric($current) ? (int) $current : 0;

            if ($loaded !== $current) {
                throw new VersionConflictException($loaded, $current);
            }
        }

        // Keep the caller's pending edits, but never its status or version.
        $pending = array_diff_key($model->getDirty(), [$model->statusColumn() => true, 'version' => true]);
        $model->setRawAttributes($locked->getAttributes(), true);

        if ($pending !== []) {
            $model->setRawAttributes(array_merge($model->getAttributes(), $pending));
        }

        return $model->currentStatus();
    }

    private static function value(string|BackedEnum $status): string
    {
        return $status instanceof BackedEnum ? (string) $status->value : $status;
    }
}
