<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Requests;

use App\Core\Sync\SyncConfig;

/**
 * pull.request.schema.json. Cursor contents are checked by the pull service
 * (SYNC_CURSOR_INVALID), not here.
 */
final class PullRequest extends SyncRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'schema_version' => ['required', 'integer', 'min:1'],
            'resources' => ['required', 'array', 'list', 'min:1'],
            'resources.*' => ['required', 'array'],
            'resources.*.resource' => ['required', 'string', 'max:80', 'regex:/\A[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\z/'],
            'resources.*.cursor' => ['present', 'nullable'],
            'resources.*.limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
        ];
    }

    /**
     * @return list<array{resource: string, cursor: mixed, limit: int|null}>
     */
    public function resources(): array
    {
        $out = [];

        foreach ((array) $this->input('resources', []) as $entry) {
            $entry = is_array($entry) ? $entry : [];
            $out[] = [
                'resource' => is_string($entry['resource'] ?? null) ? $entry['resource'] : '',
                'cursor' => $entry['cursor'] ?? null,
                'limit' => is_int($entry['limit'] ?? null) ? $entry['limit'] : null,
            ];
        }

        return $out;
    }

    protected function batchKey(): string
    {
        return 'resources';
    }

    protected function batchLimit(SyncConfig $config): int
    {
        return $config->pullResourcesMax;
    }
}
