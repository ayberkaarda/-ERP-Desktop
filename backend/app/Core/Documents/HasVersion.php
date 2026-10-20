<?php

declare(strict_types=1);

namespace App\Core\Documents;

use Illuminate\Database\Eloquent\Model;

/**
 * Optimistic locking over an integer `version` column. Every update bumps it once;
 * services call assertVersion() with the client's version, ideally after lockForUpdate().
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

        static::updating(static function (Model $model): void {
            if (! $model->isDirty('version') && method_exists($model, 'bumpVersion')) {
                $model->bumpVersion();
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
     * Sets version to the persisted value + 1; calling it twice before save is harmless.
     */
    public function bumpVersion(): static
    {
        $original = $this->getOriginal('version');
        $this->setAttribute('version', (is_numeric($original) ? (int) $original : 0) + 1);

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
}
