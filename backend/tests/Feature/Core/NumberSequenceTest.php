<?php

declare(strict_types=1);

use App\Core\Numbering\NumberSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Companies;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Companies::make();
    $this->numbers = app(NumberSequenceService::class);
});

it('issues e-invoice shaped numbers by default', function (): void {
    expect($this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000001')
        ->and($this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000002');
});

it('keeps separate counters per company, type, series and fiscal year', function (): void {
    $other = Companies::make();

    $this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026);

    expect($this->numbers->next($other, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000001')
        ->and($this->numbers->next($this->company, 'purchase_invoice', 'ABC', 2026))->toBe('ABC2026000000001')
        ->and($this->numbers->next($this->company, 'sales_invoice', 'XYZ', 2026))->toBe('XYZ2026000000001')
        ->and($this->numbers->next($this->company, 'sales_invoice', 'ABC', 2027))->toBe('ABC2027000000001')
        ->and($this->numbers->next($this->company, 'journal', null, 2026))->toBe('2026000000001');
});

it('returns a rolled back number to the sequence', function (): void {
    $this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026);

    DB::beginTransaction();
    expect($this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000002');
    DB::rollBack();

    expect($this->numbers->next($this->company, 'sales_invoice', 'ABC', 2026))->toBe('ABC2026000000002');
});

it('uses a per doc type format from config and a per row override', function (): void {
    config(['numbering.formats' => ['journal' => 'J{yy}-{seq:5}']]);
    $numbers = app(NumberSequenceService::class);

    expect($numbers->next($this->company, 'journal', null, 2026))->toBe('J26-00001');

    DB::table('number_sequences')->where('doc_type', 'journal')->update(['format' => '{series}/{year}/{seq}']);

    expect($numbers->next($this->company, 'journal', null, 2026))->toBe('/2026/2');
});

it('rejects invalid input', function (): void {
    expect(fn () => $this->numbers->next($this->company, '', null, 2026))->toThrow(InvalidArgumentException::class)
        ->and(fn () => $this->numbers->next($this->company, 'x', null, 26))->toThrow(InvalidArgumentException::class);
});
