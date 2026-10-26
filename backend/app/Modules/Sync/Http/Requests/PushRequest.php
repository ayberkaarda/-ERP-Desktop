<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Requests;

use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConfig;

/**
 * push.request.schema.json, request level only: the batch and what every result echoes
 * (idempotency_key, resource, id). Each mutation's own fields are checked per mutation and
 * come back as a rejected result instead of failing the batch.
 */
final class PushRequest extends SyncRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $uuid7 = 'regex:'.Mutation::UUID7_PATTERN;

        return [
            'schema_version' => ['required', 'integer', 'min:1'],
            'mutations' => ['required', 'array', 'list', 'min:1', 'max:500'],
            'mutations.*' => ['required', 'array'],
            'mutations.*.idempotency_key' => ['required', 'string', $uuid7],
            'mutations.*.resource' => ['required', 'string', 'max:80', 'regex:/\A[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\z/'],
            'mutations.*.id' => ['required', 'string', $uuid7],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function mutations(): array
    {
        $out = [];

        foreach ((array) $this->input('mutations', []) as $mutation) {
            $out[] = is_array($mutation) ? self::keyed($mutation) : [];
        }

        return $out;
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return array<string, mixed>
     */
    private static function keyed(array $value): array
    {
        $out = [];

        foreach ($value as $key => $item) {
            $out[(string) $key] = $item;
        }

        return $out;
    }

    protected function batchKey(): string
    {
        return 'mutations';
    }

    protected function batchLimit(SyncConfig $config): int
    {
        return $config->pushBatchMax;
    }
}
