<?php

declare(strict_types=1);

use App\Core\Numbering\NumberSequenceService;

it('formats sequence numbers', function (string $format, string $expected): void {
    expect(NumberSequenceService::format($format, 'ABC', 2026, 42))->toBe($expected);
})->with([
    ['{series}{year}{seq:9}', 'ABC2026000000042'],
    ['{series}-{yy}-{seq:4}', 'ABC-26-0042'],
    ['{seq}', '42'],
    ['INV/{year}/{seq:2}', 'INV/2026/42'],
    ['{seq:1}', '42'],
]);
