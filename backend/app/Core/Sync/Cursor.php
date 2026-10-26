<?php

declare(strict_types=1);

namespace App\Core\Sync;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use JsonSerializable;

/**
 * Keyset position of one resource in the pull stream: (sync_txid, id) plus the visibility
 * generation it was read under. With afterId null the next page starts at sync_txid >= txid;
 * otherwise strictly after (txid, afterId). Wire shape: common.schema.json#/$defs/cursor.
 */
final readonly class Cursor implements JsonSerializable
{
    public const string UUID_PATTERN = '/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/';

    public function __construct(
        public Xid8 $txid,
        public ?string $afterId,
        public int $gen,
    ) {}

    /**
     * Where a first download starts (the client sends `cursor: null`).
     */
    public static function initial(int $gen = 0): self
    {
        return new self(Xid8::zero(), null, $gen);
    }

    /**
     * Continuation after the last event of a page.
     */
    public static function after(Xid8 $txid, string $id, int $gen): self
    {
        return new self($txid, $id, $gen);
    }

    /**
     * End of the stream for now: everything below the horizon was delivered.
     */
    public static function atHorizon(Xid8 $horizon, int $gen): self
    {
        return new self($horizon, null, $gen);
    }

    /**
     * @throws ApiException SYNC_CURSOR_INVALID when the value is not a well-formed cursor
     */
    public static function fromWire(mixed $value): self
    {
        if (! is_array($value)
            || array_diff(array_keys($value), ['txid', 'after_id', 'gen']) !== []
            || ! array_key_exists('after_id', $value)) {
            throw self::invalid();
        }

        $txid = Xid8::tryOf($value['txid'] ?? null);
        $afterId = $value['after_id'];
        $gen = $value['gen'] ?? null;

        if ($txid === null
            || ! is_int($gen) || $gen < 0
            || ($afterId !== null && (! is_string($afterId) || preg_match(self::UUID_PATTERN, $afterId) !== 1))) {
            throw self::invalid();
        }

        return new self($txid, $afterId, $gen);
    }

    /**
     * A cursor beyond the current horizon was never issued by this server.
     */
    public function isAheadOf(Xid8 $horizon): bool
    {
        return $this->txid->greaterThan($horizon);
    }

    /**
     * True when pruning may have removed a tombstone this cursor still has to see.
     *
     * The floor (sync_watermarks.floor_txid, SYNC-PROTOCOL "Tombstone tabanı") is an exclusive
     * upper bound: max(pruned sync_txid) + 1. A cursor expires when cursor.txid < floor, so a
     * cursor sitting exactly on the largest pruned sync_txid (with or without after_id) is
     * reset too. Not applied to a first download (`cursor: null`).
     */
    public function expiredBy(?Xid8 $floor): bool
    {
        return $floor !== null && $this->txid->lessThan($floor);
    }

    /**
     * @return array{txid: string, after_id: string|null, gen: int}
     */
    public function toArray(): array
    {
        return ['txid' => $this->txid->value, 'after_id' => $this->afterId, 'gen' => $this->gen];
    }

    /**
     * @return array{txid: string, after_id: string|null, gen: int}
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    private static function invalid(): ApiException
    {
        return new ApiException(ErrorCode::SyncCursorInvalid);
    }
}
