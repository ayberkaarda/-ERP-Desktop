<?php

declare(strict_types=1);

namespace App\Core\Sync;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * One outbox entry of a push batch (push.request.schema.json#/$defs/mutation).
 *
 * Structural checks only; protocol rules (changed_fields equal to the payload keys, version
 * checks, depends_on ordering) belong to the push service and the conflict resolver.
 */
final readonly class Mutation
{
    public const string UUID7_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/';

    private const string RESOURCE_PATTERN = '/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/';

    /**
     * @param  list<string>  $changedFields
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $dependsOn
     */
    public function __construct(
        public string $idempotencyKey,
        public MutationOp $op,
        public string $resource,
        public string $id,
        public ?int $baseVersion,
        public array $changedFields,
        public CarbonImmutable $occurredAt,
        public array $payload,
        public ?string $action = null,
        public ?string $parentId = null,
        public array $dependsOn = [],
        public ?Resolution $resolution = null,
    ) {}

    /**
     * @param  array<array-key, mixed>  $data
     *
     * @throws ApiException VALIDATION_ERROR naming the offending fields
     */
    public static function fromArray(array $data): self
    {
        $errors = [];

        $key = self::string($data, 'idempotency_key', self::UUID7_PATTERN, $errors);
        $opValue = self::string($data, 'op', null, $errors);
        $op = $opValue === null ? null : MutationOp::tryFrom($opValue);
        $resource = self::string($data, 'resource', self::RESOURCE_PATTERN, $errors);
        $id = self::string($data, 'id', self::UUID7_PATTERN, $errors);
        $action = self::string($data, 'action', '/^[a-z][a-z-]*$/', $errors, optional: true);
        $parentId = self::string($data, 'parent_id', Cursor::UUID_PATTERN, $errors, optional: true);
        $occurred = self::string($data, 'occurred_at', null, $errors);

        if ($opValue !== null && $op === null) {
            $errors['op'] = ['The op field is invalid.'];
        }

        $baseVersion = $data['base_version'] ?? null;

        if ($baseVersion !== null && (! is_int($baseVersion) || $baseVersion < 1)) {
            $errors['base_version'] = ['The base_version field is invalid.'];
        }

        $changed = self::strings($data['changed_fields'] ?? null);
        $dependsOn = self::strings($data['depends_on'] ?? [], self::UUID7_PATTERN);
        $payload = $data['payload'] ?? null;

        if ($changed === null) {
            $errors['changed_fields'] = ['The changed_fields field is invalid.'];
        }

        if ($dependsOn === null) {
            $errors['depends_on'] = ['The depends_on field is invalid.'];
        }

        if (! is_array($payload) || ($payload !== [] && array_is_list($payload))) {
            $errors['payload'] = ['The payload field must be an object.'];
        }

        $occurredAt = null;

        if ($occurred !== null) {
            try {
                $occurredAt = CarbonImmutable::parse($occurred);
            } catch (Throwable) {
                $errors['occurred_at'] = ['The occurred_at field is invalid.'];
            }
        }

        $resolution = self::resolution($data['resolution'] ?? null, $errors);

        if ($errors !== [] || $key === null || $op === null || $resource === null || $id === null
            || $occurredAt === null || $changed === null || $dependsOn === null || ! is_array($payload)) {
            throw new ApiException(ErrorCode::ValidationError, fields: $errors);
        }

        /** @var array<string, mixed> $payload */
        return new self(
            idempotencyKey: $key,
            op: $op,
            resource: $resource,
            id: $id,
            baseVersion: is_int($baseVersion) ? $baseVersion : null,
            changedFields: $changed,
            occurredAt: $occurredAt,
            payload: $payload,
            action: $action,
            parentId: $parentId,
            dependsOn: $dependsOn,
            resolution: $resolution,
        );
    }

    /**
     * Stable digest of what the client asked for; the same key with another digest is
     * IDEMPOTENCY_KEY_REUSED. Object keys are sorted, list order is kept.
     */
    public function fingerprint(): string
    {
        $payload = $this->payload;
        self::sortRecursive($payload);

        return hash('sha256', json_encode([
            $this->op->value,
            $this->action,
            $this->resource,
            $this->id,
            $this->parentId,
            $this->baseVersion,
            $this->changedFields,
            $this->occurredAt->format('Y-m-d\TH:i:s.uP'),
            $payload,
            $this->dependsOn,
            $this->resolution?->toArray(),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
    }

    /**
     * @param  array<array-key, mixed>  $data
     * @param  array<string, list<string>>  $errors
     */
    private static function string(array $data, string $key, ?string $pattern, array &$errors, bool $optional = false): ?string
    {
        $value = $data[$key] ?? null;

        if ($value === null && $optional) {
            return null;
        }

        if (! is_string($value) || $value === '' || ($pattern !== null && preg_match($pattern, $value) !== 1)) {
            $errors[$key] = ["The {$key} field is invalid."];

            return null;
        }

        return $value;
    }

    /**
     * @return list<string>|null
     */
    private static function strings(mixed $value, ?string $pattern = null): ?array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            return null;
        }

        foreach ($value as $item) {
            if (! is_string($item) || ($pattern !== null && preg_match($pattern, $item) !== 1)) {
                return null;
            }
        }

        /** @var list<string> $value */
        return count($value) === count(array_unique($value)) ? $value : null;
    }

    /**
     * @param  array<string, list<string>>  $errors
     */
    private static function resolution(mixed $value, array &$errors): ?Resolution
    {
        if ($value === null) {
            return null;
        }

        $resolves = is_array($value) ? ($value['resolves'] ?? null) : null;
        $code = is_array($value) && is_string($value['code'] ?? null) ? ErrorCode::tryFrom($value['code']) : null;
        $choice = is_array($value) && is_string($value['choice'] ?? null) ? ConflictChoice::tryFrom($value['choice']) : null;

        if (! is_string($resolves) || preg_match(self::UUID7_PATTERN, $resolves) !== 1
            || ($code !== ErrorCode::VersionConflict && $code !== ErrorCode::DuplicateRecord)
            || ($choice !== ConflictChoice::KeepMine && $choice !== ConflictChoice::Merge)) {
            $errors['resolution'] = ['The resolution field is invalid.'];

            return null;
        }

        return new Resolution($resolves, $code, $choice);
    }

    /**
     * @param  array<array-key, mixed>  $value
     */
    private static function sortRecursive(array &$value): void
    {
        if (! array_is_list($value)) {
            ksort($value);
        }

        foreach ($value as &$item) {
            if (is_array($item)) {
                self::sortRecursive($item);
            }
        }
    }
}
