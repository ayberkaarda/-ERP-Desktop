<?php

declare(strict_types=1);

namespace App\Core\Sync;

use Illuminate\Contracts\Config\Repository;

/**
 * Typed view of config/sync.php.
 */
final readonly class SyncConfig
{
    /** Idempotency scope of push mutations (user + company + this + key). */
    public const string PUSH_IDEMPOTENCY_SCOPE = 'sync.push';

    public function __construct(
        public int $schemaVersion = 1,
        public int $minSchemaVersion = 1,
        public string $manifestPath = '',
        public int $pullResourcesMax = 32,
        public int $pullPageDefault = 200,
        public int $pullPageMax = 1000,
        public int $pushBatchMax = 200,
        public int $tombstoneRetentionDays = 90,
        public int $idempotencyRetentionDays = 7,
    ) {}

    public static function fromConfig(Repository $config): self
    {
        $int = static function (string $key, int $default) use ($config): int {
            $value = $config->get("sync.{$key}");

            return is_numeric($value) && (int) $value > 0 ? (int) $value : $default;
        };
        $path = $config->get('sync.manifest_path');

        return new self(
            schemaVersion: $int('schema_version', 1),
            minSchemaVersion: $int('min_schema_version', 1),
            manifestPath: is_string($path) ? $path : '',
            pullResourcesMax: $int('limits.pull_resources_max', 32),
            pullPageDefault: $int('limits.pull_page_default', 200),
            pullPageMax: $int('limits.pull_page_max', 1000),
            pushBatchMax: $int('limits.push_batch_max', 200),
            tombstoneRetentionDays: $int('tombstone_retention_days', 90),
            idempotencyRetentionDays: $int('idempotency_retention_days', 7),
        );
    }

    public function supportsSchema(int $version): bool
    {
        return $version >= $this->minSchemaVersion && $version <= $this->schemaVersion;
    }

    public function idempotencyTtlSeconds(): int
    {
        return $this->idempotencyRetentionDays * 86400;
    }
}
