<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\WriteOutcome;
use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Tests\Fixtures\Sync\FixtureNoteSyncWriter;

/**
 * The P1 fixture writer with optional hooks, so tests can play module behaviour the fixture
 * does not have: a duplicate check, a derivation the manifest does not declare, a concurrent
 * insert of the same id. Without hooks it is the fixture writer.
 */
final class ScriptedNoteWriter implements SyncWriter
{
    /** @var (Closure(Mutation): ?WriteOutcome)|null runs before create; a returned outcome replaces it */
    public static ?Closure $beforeCreate = null;

    /** @var (Closure(Model, Mutation): void)|null runs after a successful update, in its transaction */
    public static ?Closure $afterUpdate = null;

    /** @var (Closure(Mutation): ?WriteOutcome)|null runs instead of update when it returns an outcome (REST refusals) */
    public static ?Closure $replaceUpdate = null;

    /** @var list<string>|null */
    public static ?array $auditFields = null;

    private FixtureNoteSyncWriter $inner;

    public function __construct()
    {
        $this->inner = new FixtureNoteSyncWriter;
    }

    public static function reset(): void
    {
        self::$beforeCreate = null;
        self::$afterUpdate = null;
        self::$replaceUpdate = null;
        self::$auditFields = null;
    }

    public function resource(): string
    {
        return $this->inner->resource();
    }

    public function find(string $id): ?Model
    {
        return $this->inner->find($id);
    }

    public function currentVersion(Model $target): int
    {
        return $this->inner->currentVersion($target);
    }

    public function isDraft(Model $target): bool
    {
        return $this->inner->isDraft($target);
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        return $this->inner->targetSatisfies($target, $constraints);
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        $hook = self::$beforeCreate;
        $replaced = $hook !== null ? $hook($mutation) : null;

        return $replaced ?? $this->inner->create($user, $mutation);
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        $replace = self::$replaceUpdate;
        $outcome = ($replace !== null ? $replace($mutation) : null) ?? $this->inner->update($user, $mutation, $target, $version);
        $hook = self::$afterUpdate;

        if ($hook !== null && $outcome->succeeded()) {
            $hook($target, $mutation);
        }

        return $outcome;
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return $this->inner->delete($user, $mutation, $target, $version);
    }

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return $this->inner->action($user, $mutation, $target, $version);
    }

    public function lockedFields(): array
    {
        return $this->inner->lockedFields();
    }

    public function auditFields(): array
    {
        return self::$auditFields ?? $this->inner->auditFields();
    }
}
