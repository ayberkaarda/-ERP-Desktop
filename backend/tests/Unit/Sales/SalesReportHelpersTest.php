<?php

declare(strict_types=1);

use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Services\SalesByPeriodReport;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;

it('keys periods by ISO week across a year boundary, by day and by month', function (): void {
    expect(SalesByPeriodReport::key('2027-01-01', 'week'))->toBe('2026-W53')
        ->and(SalesByPeriodReport::key('2027-01-04', 'week'))->toBe('2027-W01')
        ->and(SalesByPeriodReport::key('2027-12-31', 'week'))->toBe('2027-W52')
        ->and(SalesByPeriodReport::key('2027-02-28', 'month'))->toBe('2027-02')
        ->and(SalesByPeriodReport::key('2027-02-28', 'day'))->toBe('2027-02-28');
});

it('formats decimals without floats and leaves undefined ratios empty', function (): void {
    expect(Num::money(BigDecimal::of('1.23456')))->toBe('1.2346')
        ->and(Num::money(BigDecimal::of('-0.00005')))->toBe('-0.0001')
        ->and(Num::qty(BigDecimal::of('2')))->toBe('2.000000')
        ->and(Num::percent(BigDecimal::of('1'), BigDecimal::of('3')))->toBe('33.33')
        ->and(Num::percent(BigDecimal::of('2'), BigDecimal::of('3')))->toBe('66.67')
        ->and(Num::percent(BigDecimal::of('1'), BigDecimal::zero()))->toBeNull()
        ->and(Num::ratio(BigDecimal::of('10'), BigDecimal::of('3')))->toBe('3.3333')
        ->and(Num::ratio(BigDecimal::of('10'), BigDecimal::zero()))->toBeNull()
        ->and((string) Num::cents(BigDecimal::of('0.125')))->toBe('0.13');
});

it('treats open range ends as unbounded', function (): void {
    $f = new ReportFilters('c', '2027-06-01', '2027-06-30');
    $open = new ReportFilters('c');

    expect($f->inRange('2027-06-01'))->toBeTrue()
        ->and($f->inRange('2027-06-30'))->toBeTrue()
        ->and($f->inRange('2027-07-01'))->toBeFalse()
        ->and($f->inRange('2027-05-31'))->toBeFalse()
        ->and($open->inRange('1999-01-01'))->toBeTrue();
});
