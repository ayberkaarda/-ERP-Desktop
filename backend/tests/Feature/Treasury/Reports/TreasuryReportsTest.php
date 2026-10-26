<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Treasury\Banking\ExtensionKit;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = ExtensionKit::world();
});

it('reports signed cash flow and historical account balances including reversals', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $payment = ExtensionKit::receipt($w, $bank);
    PurchKit::post($w->user, $w->company, 'treasury-payments/'.$payment['id'].'/reverse', ['version' => $payment['version'], 'date' => '2027-06-16', 'reason' => 'Reversed'])->assertOk();
    PurchKit::get($w->user, $w->company, 'treasury-reports/account-balances?as_of=2027-06-15')->assertOk()->assertJsonPath('data.0.balance', '100.0000');
    PurchKit::get($w->user, $w->company, 'treasury-reports/account-balances?as_of=2027-06-16')->assertOk()->assertJsonPath('data.0.balance', '0.0000');
    $flow = PurchKit::get($w->user, $w->company, 'treasury-reports/cash-flow?date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json('data');
    expect($flow)->toHaveCount(2)->and($flow[0]['inflow'])->toBe('100.0000')->and($flow[1]['outflow'])->toBe('100.0000');
});

it('ages invoice balances at effective settlement dates and restores balances only from reversal date', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'sales');
    $bank = ExtensionKit::bank($w);
    $draft = PurchKit::post($w->user, $w->company, 'treasury-payments', ['direction' => 'receipt', 'account_id' => $bank['id'],
        'party_id' => $w->customer->id, 'document_date' => '2027-06-12', 'amount' => '40', 'currency_code' => 'TRY', 'fx_rate' => '1',
        'allocations' => [['invoice_module' => 'sales', 'invoice_id' => $invoice['id'], 'amount' => '40', 'fx_rate' => '1']]])->assertCreated()->json('data');
    $payment = PurchKit::post($w->user, $w->company, 'treasury-payments/'.$draft['id'].'/post', ['version' => $draft['version']])->assertOk()->json('data');
    PurchKit::post($w->user, $w->company, 'treasury-payments/'.$payment['id'].'/reverse', ['version' => $payment['version'], 'date' => '2027-06-14', 'reason' => 'Correction'])->assertOk();
    foreach (['2027-06-11' => '120.0000', '2027-06-13' => '80.0000', '2027-06-14' => '120.0000'] as $date => $balance) {
        PurchKit::get($w->user, $w->company, 'treasury-reports/receivables-ageing?as_of='.$date)->assertOk()->assertJsonPath('data.0.balance', $balance);
    }
});

it('exports text-safe forecast cells and produces xlsx and rejects unsupported historical current-state reports', function (): void {
    $w = $this->w;
    PurchKit::post($w->user, $w->company, 'treasury-payment-plans', ['direction' => 'payment', 'party_id' => $w->party->id,
        'currency_code' => 'TRY', 'amount' => '12.34', 'due_date' => '2027-06-20', 'description' => '=HYPERLINK("unsafe")'])->assertCreated();
    $response = PurchKit::get($w->user, $w->company, 'treasury-reports/payment-forecast/export?date_to=2027-06-30&format=csv')->assertOk();
    expect($response->streamedContent())->toContain("'=HYPERLINK");
    PurchKit::get($w->user, $w->company, 'treasury-reports/payment-forecast/export?date_to=2027-06-30&format=xlsx')->assertOk()
        ->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    PurchKit::get($w->user, $w->company, 'treasury-reports/reconciliation-status?as_of=2027-06-01')->assertUnprocessable();
});

it('protects report permissions and source invoice visibility before validating filters', function (): void {
    $w = $this->w;
    $none = Actors::user([], $w->company);
    foreach (['cash-flow', 'account-balances', 'receivables-ageing', 'payables-ageing', 'payment-forecast', 'instrument-portfolio', 'reconciliation-status'] as $report) {
        PurchKit::get($none, $w->company, 'treasury-reports/'.$report.'?as_of=invalid')->assertForbidden();
    }
    $reader = Actors::user(['treasury.reports.view'], $w->company);
    PurchKit::get($reader, $w->company, 'treasury-reports/receivables-ageing')->assertForbidden();
    PurchKit::get($reader, $w->company, 'treasury-reports/cash-flow')->assertOk();
});
