<?php

declare(strict_types=1);

namespace App\Core\Documents;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Optimistic locking over an integer `version` column.
 *
 * Every update is a compare-and-swap: UPDATE ... SET version = v+1 WHERE id = ? AND version = v,
 * where v is the version this instance was loaded with. Zero affected rows means someone else
 * saved first and VersionConflictException is thrown, so there is no read-then-write race.
 * assertVersion() additionally rejects a client payload that was built from an older version.
 *
 * @mixin Model
 */
trait HasVersion
{
    public static function bootHasVersion(): void
    {
        static::creating(static function (Model $model): void {
            if ($model->getAttribute('version') === null) {
                $model->setAttribute('version', 1);
            }
        });
    }

    public function initializeHasVersion(): void
    {
        $this->mergeCasts(['version' => 'integer']);
    }

    public function currentVersion(): int
    {
        $version = $this->getAttribute('version');

        return is_numeric($version) ? (int) $version : 0;
    }

    /**
     * Sets version to the loaded value + 1; calling it twice before save is harmless.
     */
    public function bumpVersion(): static
    {
        $this->setAttribute('version', $this->loadedVersion() + 1);

        return $this;
    }

    /**
     * @throws VersionConflictException
     */
    public function assertVersion(int $expected): void
    {
        $current = $this->currentVersion();

        if ($expected !== $current) {
            throw new VersionConflictException($expected, $current);
        }
    }

    /**
     * @param  Builder<static>  $query
     *
     * @throws VersionConflictException
     */
    protected function performUpdate(Builder $query): bool
    {
        if ($this->fireModelEvent('updating') === false) {
            return false;
        }

        if ($this->usesTimestamps()) {
            $this->updateTimestamps();
        }

        $dirty = $this->getDirtyForUpdate();

        if (count($dirty) === 0) {
            return true;
        }

        $loaded = $this->loadedVersion();
        $this->bumpVersion();
        $dirty['version'] = $loaded + 1;

        $affected = $this->setKeysForSaveQuery($query)
            ->where($this->qualifyColumn('version'), $loaded)
            ->update($dirty);

        if ($affected === 0) {
            $this->setAttribute('version', $loaded);
            $current = $this->newQueryWithoutScopes()->whereKey($this->getKey())->toBase()->value('version');

            throw new VersionConflictException($loaded, is_numeric($current) ? (int) $current : 0);
        }

        $this->refreshSavedAttributes();
        $this->syncChanges();
        $this->fireModelEvent('updated', false);

        return true;
    }

    private function loadedVersion(): int
    {
        $original = $this->getOriginal('version');

        return is_numeric($original) ? (int) $original : 0;
    }
}
