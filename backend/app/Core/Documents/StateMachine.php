<?php

declare(strict_types=1);

namespace App\Core\Documents;

use BackedEnum;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

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

        return DB::transaction(function () use ($model, $to, $actor): Model {
            $from = $this->lockedStatus($model);

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
     * Re-reads the status under a row lock so two concurrent transitions serialize.
     */
    private function lockedStatus(Model&HasStatus $model): string
    {
        if (! $model->exists) {
            return $model->currentStatus();
        }

        $column = $model->statusColumn();
        $raw = $model->newQueryWithoutScopes()
            ->whereKey($model->getKey())
            ->lockForUpdate()
            ->value($column);

        $current = is_scalar($raw) ? (string) $raw : $model->currentStatus();

        if ($current !== $model->currentStatus()) {
            $model->applyStatus($current);
            $model->syncOriginalAttribute($column);
        }

        return $current;
    }

    private static function value(string|BackedEnum $status): string
    {
        return $status instanceof BackedEnum ? (string) $status->value : $status;
    }
}
