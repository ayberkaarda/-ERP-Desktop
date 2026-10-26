<?php

declare(strict_types=1);

namespace App\Core\Sync;

use App\Core\Http\ErrorCode;
use InvalidArgumentException;

/**
 * Conflict body of a push result (push.response.schema.json#/$defs/conflict).
 */
final readonly class SyncConflict
{
    /**
     * @param  list<string>  $conflictingFields
     * @param  array<string, mixed>|null  $serverData
     * @param  list<ConflictChoice>  $choices
     * @param  list<string>  $candidates
     */
    public function __construct(
        public ErrorCode $code,
        public ?int $baseVersion,
        public ?int $serverVersion,
        public array $conflictingFields,
        public ?array $serverData,
        public array $choices,
        public array $candidates = [],
        public ?string $message = null,
    ) {
        if (! in_array($code, [ErrorCode::VersionConflict, ErrorCode::DocumentLocked, ErrorCode::DuplicateRecord], true)) {
            throw new InvalidArgumentException("{$code->value} is not a sync conflict code.");
        }

        if ($choices === []) {
            throw new InvalidArgumentException('A conflict offers at least one choice.');
        }
    }

    /**
     * @param  list<string>  $conflictingFields
     * @param  array<string, mixed>  $serverData
     */
    public static function versionConflict(int $baseVersion, int $serverVersion, array $conflictingFields, array $serverData): self
    {
        return new self(
            ErrorCode::VersionConflict,
            $baseVersion,
            $serverVersion,
            $conflictingFields,
            $serverData,
            [ConflictChoice::KeepMine, ConflictChoice::TakeServer, ConflictChoice::Merge],
        );
    }

    /**
     * @param  array<string, mixed>  $serverData
     */
    public static function documentLocked(?int $baseVersion, int $serverVersion, array $serverData): self
    {
        return new self(
            ErrorCode::DocumentLocked,
            $baseVersion,
            $serverVersion,
            [],
            $serverData,
            [ConflictChoice::SaveAsNewDraft, ConflictChoice::Discard],
        );
    }

    /**
     * @param  list<string>  $candidates  ids of the likely duplicates
     */
    public static function duplicateRecord(array $candidates): self
    {
        if ($candidates === []) {
            throw new InvalidArgumentException('DUPLICATE_RECORD needs at least one candidate.');
        }

        return new self(
            ErrorCode::DuplicateRecord,
            null,
            null,
            [],
            null,
            [ConflictChoice::UseExisting, ConflictChoice::KeepMine, ConflictChoice::Discard],
            $candidates,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $out = [
            'code' => $this->code->value,
            'message' => $this->message ?? $this->code->message(),
            'base_version' => $this->baseVersion,
            'server_version' => $this->serverVersion,
            'conflicting_fields' => $this->conflictingFields,
            'server_data' => $this->serverData,
            'choices' => array_map(static fn (ConflictChoice $c): string => $c->value, $this->choices),
        ];

        if ($this->candidates !== []) {
            $out['candidates'] = $this->candidates;
        }

        return $out;
    }

    /**
     * @param  array<array-key, mixed>  $data  output of toArray()
     */
    public static function fromArray(array $data): self
    {
        $code = ErrorCode::from(self::str($data['code'] ?? null));
        $choices = [];

        foreach (is_array($data['choices'] ?? null) ? $data['choices'] : [] as $choice) {
            $choices[] = ConflictChoice::from(self::str($choice));
        }

        $serverData = $data['server_data'] ?? null;

        /** @var array<string, mixed>|null $serverData */
        return new self(
            $code,
            is_int($data['base_version'] ?? null) ? $data['base_version'] : null,
            is_int($data['server_version'] ?? null) ? $data['server_version'] : null,
            self::list($data['conflicting_fields'] ?? []),
            is_array($serverData) ? $serverData : null,
            $choices,
            self::list($data['candidates'] ?? []),
            is_string($data['message'] ?? null) ? $data['message'] : null,
        );
    }

    private static function str(mixed $value): string
    {
        return is_string($value) ? $value : '';
    }

    /**
     * @return list<string>
     */
    private static function list(mixed $value): array
    {
        return is_array($value) ? array_values(array_filter($value, 'is_string')) : [];
    }
}
