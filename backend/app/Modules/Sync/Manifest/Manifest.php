<?php

declare(strict_types=1);

namespace App\Modules\Sync\Manifest;

use App\Core\Sync\MutationOp;
use App\Core\Sync\SyncScope;
use RuntimeException;

/**
 * Parsed contracts/offline-manifest.json (the file is validated against its schema in CI;
 * parsing here only keeps what the server needs and fails loudly on a broken file).
 */
final readonly class Manifest
{
    /**
     * @param  array<string, ManifestResource>  $resources  by name, manifest order (children after their parent)
     * @param  list<array{action: string, routes: list<string>}>  $onlineOnly
     */
    public function __construct(
        public int $version,
        public array $resources,
        public array $onlineOnly,
    ) {}

    public static function fromFile(string $path): self
    {
        $json = is_file($path) ? file_get_contents($path) : false;
        $data = is_string($json) ? json_decode($json, true) : null;

        if (! is_array($data) || ! is_int($data['manifest_version'] ?? null) || ! is_array($data['resources'] ?? null)) {
            throw new RuntimeException("Offline manifest {$path} is missing or invalid.");
        }

        return self::fromArray($data);
    }

    /**
     * @param  array<array-key, mixed>  $data
     */
    public static function fromArray(array $data): self
    {
        $recentWindow = is_int($data['defaults']['recent_window_days'] ?? null) ? $data['defaults']['recent_window_days'] : null;
        $resources = [];

        foreach (is_array($data['resources'] ?? null) ? $data['resources'] : [] as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $parent = self::resource($entry, null, $recentWindow);
            $resources[$parent->name] = $parent;

            foreach (is_array($entry['children'] ?? null) ? $entry['children'] : [] as $child) {
                if (! is_array($child)) {
                    continue;
                }

                $resource = new ManifestResource(
                    name: self::str($child['resource'] ?? null),
                    scope: $parent->scope,
                    read: $parent->read,
                    source: 'pull',
                    path: self::str($child['path'] ?? null),
                    requires: $parent->requires,
                    write: is_array($child['write'] ?? null) ? self::write($child['write']) : null,
                    parent: $parent->name,
                );
                $resources[$resource->name] = $resource;
            }
        }

        $onlineOnly = [];

        foreach (is_array($data['online_only'] ?? null) ? $data['online_only'] : [] as $entry) {
            if (is_array($entry) && is_string($entry['action'] ?? null)) {
                $onlineOnly[] = ['action' => $entry['action'], 'routes' => self::strings($entry['routes'] ?? [])];
            }
        }

        return new self(is_int($data['manifest_version'] ?? null) ? $data['manifest_version'] : 1, $resources, $onlineOnly);
    }

    public function find(string $name): ?ManifestResource
    {
        return $this->resources[$name] ?? null;
    }

    /**
     * @return list<string>
     */
    public static function strings(mixed $value): array
    {
        return is_array($value) ? array_values(array_filter($value, 'is_string')) : [];
    }

    /**
     * @param  array<array-key, mixed>  $entry
     */
    private static function resource(array $entry, ?string $parent, ?int $recentWindow): ManifestResource
    {
        $window = $entry['window_days'] ?? null;

        return new ManifestResource(
            name: self::str($entry['resource'] ?? null),
            scope: SyncScope::tryFrom(self::str($entry['scope'] ?? 'company')) ?? SyncScope::Company,
            read: self::str($entry['read'] ?? 'local-first'),
            source: self::str($entry['source'] ?? 'pull'),
            path: self::str($entry['path'] ?? null),
            requires: Requirement::fromArray($entry['requires'] ?? null),
            windowDays: is_int($window) ? $window : null,
            windowField: is_int($window) && is_string($entry['window_field'] ?? null) ? $entry['window_field'] : null,
            write: is_array($entry['write'] ?? null) ? self::write($entry['write']) : null,
            parent: $parent,
        );
    }

    /**
     * @param  array<array-key, mixed>  $write
     */
    private static function write(array $write): WriteDefinition
    {
        $ops = [];

        foreach (is_array($write['ops'] ?? null) ? $write['ops'] : [] as $op) {
            if (! is_array($op)) {
                continue;
            }

            $kind = MutationOp::tryFrom(self::str($op['op'] ?? null));

            if ($kind === null) {
                continue;
            }

            $ops[] = new WriteOp(
                $kind,
                is_string($op['action'] ?? null) ? $op['action'] : null,
                self::str($op['route'] ?? null),
                Requirement::fromArray($op['requires'] ?? null),
                self::str($op['version_check'] ?? ($kind === MutationOp::Create ? 'none' : 'exact')),
            );
        }

        $derived = [];

        foreach (is_array($write['derived_fields'] ?? null) ? $write['derived_fields'] : [] as $rule) {
            if (is_array($rule)) {
                $derived[] = ['when' => self::strings($rule['when'] ?? []), 'derives' => self::strings($rule['derives'] ?? [])];
            }
        }

        $draft = $write['draft_only'] ?? null;

        return new WriteDefinition(
            ops: $ops,
            derivedFields: $derived,
            draftOnly: is_array($draft) && is_string($draft['field'] ?? null) && is_string($draft['value'] ?? null)
                ? ['field' => $draft['field'], 'value' => $draft['value']]
                : null,
            targetConstraints: self::constraints($write['target_constraints'] ?? null),
            payloadConstraints: self::constraints($write['payload_constraints'] ?? null),
            duplicateCheck: is_string($write['duplicate_check'] ?? null) ? $write['duplicate_check'] : null,
        );
    }

    /**
     * @return array<string, list<string>>
     */
    private static function constraints(mixed $value): array
    {
        $out = [];

        foreach (is_array($value) ? $value : [] as $field => $allowed) {
            if (is_string($field)) {
                $out[$field] = self::strings($allowed);
            }
        }

        return $out;
    }

    private static function str(mixed $value): string
    {
        return is_string($value) ? $value : '';
    }
}
