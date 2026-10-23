<?php

declare(strict_types=1);

use App\Modules\Treasury\Contracts\TreasuryInvoiceAccess;
use App\Modules\Treasury\Data\TreasuryInvoiceData;
use App\Modules\Treasury\Reports\Services\TreasuryReports;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

uses(TestCase::class);

it('accepts exactly fifty thousand source invoices and rejects the next source row', function (): void {
    $invoice = new TreasuryInvoiceData('01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002', 'sales', 'INV-1', 'sale', 'issued',
        '01900000-0000-7000-8000-000000000003', 'Customer', '2027-06-01', '2027-06-30', 'TRY', '1', '1', '1', '0', '1', balanceLocal: '1');
    $size = 50000;
    $reader = Mockery::mock(TreasuryInvoiceAccess::class);
    $reader->shouldReceive('openForCompany')->andReturnUsing(static function (string $module, int $page, int $perPage, ?string $asOf) use ($invoice, &$size): array {
        $offset = ($page - 1) * $perPage;

        return array_fill(0, max(0, min($perPage, $size - $offset)), $invoice);
    });
    app()->instance(TreasuryInvoiceAccess::class, $reader);
    $report = app(TreasuryReports::class)->table('receivables-ageing', ['as_of' => '2027-06-30'], 0, 2);
    expect($report->total)->toBe(50000)->and($report->rows)->toHaveCount(2)->and($report->meta['by_currency']['TRY'])->toBe('50000.0000');
    unset($report);
    $size = 50001;
    expect(fn () => app(TreasuryReports::class)->table('receivables-ageing', ['as_of' => '2027-06-30', 'party_id' => '01900000-0000-7000-8000-000000000099'], 0, 2))->toThrow(ValidationException::class);
});
