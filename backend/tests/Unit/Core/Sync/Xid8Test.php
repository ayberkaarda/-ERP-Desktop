<?php

declare(strict_types=1);

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;

it('accepts canonical decimal xid8 values up to 2^64-1', function (string $value): void {
    expect(Xid8::of($value)->value)->toBe($value)
        ->and(Xid8::isValid($value))->toBeTrue();
})->with(['0', '1', '742', '9007199254740993', Xid8::MAX]);

it('rejects anything else', function (string $value): void {
    expect(Xid8::isValid($value))->toBeFalse()
        ->and(Xid8::tryOf($value))->toBeNull();
})->with(['', '-1', '01', '1.5', ' 1', '18446744073709551616', '99999999999999999999', 'abc', '1e3', "9\n", "1\r\n", "\n1"]);

it('does not let a trailing newline sort above a longer value', function (): void {
    expect(fn () => Xid8::of("9\n"))->toThrow(InvalidArgumentException::class)
        ->and(preg_match(Cursor::UUID_PATTERN, "01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e5f\n"))->toBe(0);
});

it('compares numerically beyond the PHP integer range', function (): void {
    $small = Xid8::of('9');
    $big = Xid8::of('10');
    $huge = Xid8::of('18446744073709551614');

    expect($small->lessThan($big))->toBeTrue()
        ->and($big->greaterThan($small))->toBeTrue()
        ->and($huge->lessThan(Xid8::of(Xid8::MAX)))->toBeTrue()
        ->and($big->compare(Xid8::of('10')))->toBe(0)
        ->and($big->lessThanOrEqual(Xid8::of('10')))->toBeTrue()
        ->and(Xid8::max($small, $huge))->toBe($huge)
        ->and(json_encode(['t' => $huge]))->toBe('{"t":"18446744073709551614"}');
});

it('accepts non-negative ints through tryOf', function (): void {
    expect(Xid8::tryOf(42)?->value)->toBe('42')
        ->and(Xid8::tryOf(-1))->toBeNull()
        ->and(Xid8::tryOf(null))->toBeNull();
});

it('parses the wire cursor and round-trips it', function (): void {
    $wire = ['txid' => '1000', 'after_id' => '01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e5f', 'gen' => 3];
    $cursor = Cursor::fromWire($wire);

    expect($cursor->toArray())->toBe($wire)
        ->and(Cursor::initial(2)->toArray())->toBe(['txid' => '0', 'after_id' => null, 'gen' => 2])
        ->and(Cursor::atHorizon(Xid8::of('77'), 1)->toArray())->toBe(['txid' => '77', 'after_id' => null, 'gen' => 1]);
});

it('expires cursors at or below the tombstone floor, inclusive', function (): void {
    $cursor = Cursor::fromWire(['txid' => '500', 'after_id' => null, 'gen' => 0]);

    expect($cursor->expiredBy(null))->toBeFalse()
        ->and($cursor->expiredBy(Xid8::of('499')))->toBeFalse()
        ->and($cursor->expiredBy(Xid8::of('500')))->toBeTrue()
        ->and($cursor->expiredBy(Xid8::of('501')))->toBeTrue()
        ->and(Cursor::after(Xid8::of('500'), '01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e5f', 0)->expiredBy(Xid8::of('500')))->toBeTrue();
});

it('knows when a cursor is past the horizon', function (): void {
    $cursor = Cursor::fromWire(['txid' => '500', 'after_id' => null, 'gen' => 0]);

    expect($cursor->isAheadOf(Xid8::of('500')))->toBeFalse()
        ->and($cursor->isAheadOf(Xid8::of('499')))->toBeTrue();
});
