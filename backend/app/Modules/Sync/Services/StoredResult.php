<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Idempotency\StoredResponse;
use App\Core\Sync\WriteOutcome;
use InvalidArgumentException;

/**
 * A push result as stored for its key: the mutation it answered and the outcome.
 */
final readonly class StoredResult
{
    public function __construct(
        public string $op,
        public ?string $action,
        public string $resource,
        public string $id,
        public WriteOutcome $outcome,
        public ?string $payloadHash = null,
    ) {}

    public static function fromResponse(StoredResponse $response): self
    {
        $data = json_decode($response->body, true);

        if (! is_array($data) || ! is_array($data['outcome'] ?? null)) {
            throw new InvalidArgumentException('Stored push result is not readable.');
        }

        return new self(
            is_string($data['op'] ?? null) ? $data['op'] : '',
            is_string($data['action'] ?? null) ? $data['action'] : null,
            is_string($data['resource'] ?? null) ? $data['resource'] : '',
            is_string($data['id'] ?? null) ? $data['id'] : '',
            WriteOutcome::fromArray($data['outcome']),
            is_string($data['payload_hash'] ?? null) ? $data['payload_hash'] : null,
        );
    }
}
