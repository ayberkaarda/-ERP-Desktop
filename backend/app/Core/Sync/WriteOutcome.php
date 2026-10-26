<?php

declare(strict_types=1);

namespace App\Core\Sync;

use App\Core\Http\ErrorCode;
use InvalidArgumentException;

/**
 * What an adapter did with one mutation. Serialises to the push result body
 * (push.response.schema.json#/$defs/result) and back, so a stored outcome can be replayed
 * for the same idempotency key with the same status (applied replays as duplicate).
 */
final readonly class WriteOutcome
{
    /**
     * @param  array<string, mixed>|null  $data
     * @param  list<string>  $mergedFields
     * @param  array<string, list<string>>|null  $errorFields
     */
    private function __construct(
        public OutcomeStatus $status,
        public ?int $version = null,
        public ?array $data = null,
        public array $mergedFields = [],
        public ?SyncConflict $conflict = null,
        public ?ErrorCode $errorCode = null,
        public ?string $errorMessage = null,
        public ?array $errorFields = null,
    ) {}

    /**
     * Written; $data is the REST API Resource JSON with the manifest embeds loaded.
     *
     * @param  array<string, mixed>  $data
     * @param  list<string>  $mergedFields  fields applied over newer server changes (no overlap)
     */
    public static function applied(int $version, array $data, array $mergedFields = []): self
    {
        return new self(OutcomeStatus::Applied, $version, $data, $mergedFields);
    }

    /**
     * Applied delete: no version, data null.
     */
    public static function deleted(): self
    {
        return new self(OutcomeStatus::Applied);
    }

    public static function conflict(SyncConflict $conflict): self
    {
        return new self(OutcomeStatus::Conflict, conflict: $conflict);
    }

    /**
     * @param  array<string, list<string>>|null  $fields
     */
    public static function rejected(ErrorCode $code, ?string $message = null, ?array $fields = null): self
    {
        return new self(OutcomeStatus::Rejected, errorCode: $code, errorMessage: $message, errorFields: $fields);
    }

    public function succeeded(): bool
    {
        return $this->status === OutcomeStatus::Applied || $this->status === OutcomeStatus::Duplicate;
    }

    /**
     * The same outcome served again from the store: applied becomes duplicate, the rest keep
     * their status.
     */
    public function replay(): self
    {
        if ($this->status !== OutcomeStatus::Applied) {
            return $this;
        }

        return new self(OutcomeStatus::Duplicate, $this->version, $this->data, $this->mergedFields);
    }

    /**
     * Full wire result for the mutation it answers.
     *
     * @return array<string, mixed>
     */
    public function toResult(Mutation $mutation, bool $replayed = false): array
    {
        return [
            'idempotency_key' => $mutation->idempotencyKey,
            'resource' => $mutation->resource,
            'id' => $mutation->id,
            ...$this->toArray(),
            'replayed' => $replayed || $this->status === OutcomeStatus::Duplicate,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $out = ['status' => $this->status->value];

        switch ($this->status) {
            case OutcomeStatus::Applied:
            case OutcomeStatus::Duplicate:
                if ($this->version !== null) {
                    $out['version'] = $this->version;
                }

                $out['data'] = $this->data;

                if ($this->mergedFields !== []) {
                    $out['merged_fields'] = $this->mergedFields;
                }

                break;
            case OutcomeStatus::Conflict:
                $out['conflict'] = $this->conflict?->toArray();

                break;
            case OutcomeStatus::Rejected:
                $code = $this->errorCode ?? ErrorCode::ServerError;
                $out['error'] = array_filter([
                    'message' => $this->errorMessage ?? $code->message(),
                    'code' => $code->value,
                    'fields' => $this->errorFields,
                ], static fn (mixed $v): bool => $v !== null);

                break;
        }

        return $out;
    }

    /**
     * @param  array<array-key, mixed>  $data  output of toArray()
     */
    public static function fromArray(array $data): self
    {
        $status = OutcomeStatus::tryFrom(is_string($data['status'] ?? null) ? $data['status'] : '');

        return match ($status) {
            OutcomeStatus::Applied, OutcomeStatus::Duplicate => new self(
                $status,
                is_int($data['version'] ?? null) ? $data['version'] : null,
                self::map($data['data'] ?? null),
                is_array($data['merged_fields'] ?? null) ? array_values(array_filter($data['merged_fields'], 'is_string')) : [],
            ),
            OutcomeStatus::Conflict => self::conflict(SyncConflict::fromArray(is_array($data['conflict'] ?? null) ? $data['conflict'] : [])),
            OutcomeStatus::Rejected => self::rejectedFrom(is_array($data['error'] ?? null) ? $data['error'] : []),
            null => throw new InvalidArgumentException('Stored outcome has no valid status.'),
        };
    }

    /**
     * @param  array<array-key, mixed>  $error
     */
    private static function rejectedFrom(array $error): self
    {
        $code = ErrorCode::tryFrom(is_string($error['code'] ?? null) ? $error['code'] : '') ?? ErrorCode::ServerError;
        $fields = $error['fields'] ?? null;

        /** @var array<string, list<string>>|null $fields */
        return self::rejected($code, is_string($error['message'] ?? null) ? $error['message'] : null, is_array($fields) ? $fields : null);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function map(mixed $value): ?array
    {
        /** @var array<string, mixed>|null */
        return is_array($value) ? $value : null;
    }
}
