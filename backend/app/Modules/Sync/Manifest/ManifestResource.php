<?php

declare(strict_types=1);

namespace App\Modules\Sync\Manifest;

use App\Core\Sync\SyncScope;

/**
 * One pull/snapshot stream of offline-manifest.json. Children (`items.variants`) are flattened
 * into their own entries; they inherit the parent's scope, read mode and requirement.
 */
final readonly class ManifestResource
{
    public function __construct(
        public string $name,
        public SyncScope $scope,
        /** local-first | online-first | offline-fallback */
        public string $read,
        /** pull | snapshot */
        public string $source,
        public string $path,
        public Requirement $requires,
        public ?int $windowDays = null,
        public ?string $windowField = null,
        public ?WriteDefinition $write = null,
        public ?string $parent = null,
    ) {}

    public function isPull(): bool
    {
        return $this->source === 'pull';
    }
}
