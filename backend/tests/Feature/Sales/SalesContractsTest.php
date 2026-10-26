<?php

declare(strict_types=1);

use App\Modules\Sales\Contracts\CustomerExposure;
use App\Modules\Sales\Contracts\ReceivableSettlement;
use App\Modules\Sales\Contracts\SalesInvoiceLookup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10', 'due_date' => '2027-07-10',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->json('data');
    $this->invoice = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/issue")->assertOk()->json('data');
    $this->settlement = app(ReceivableSettlement::class);
});

it('applies and unapplies settlements idempotently by reference', function (): void {
    $first = $this->settlement->apply($this->w->company, $this->invoice['id'], '50', 'BANK-1');
    expect($first->paidAmount)->toBe('50.0000')->and($first->balanceDue)->toBe('70.0000')->and($first->status)->toBe('partially_paid')->and($first->replayed)->toBeFalse();

    $again = $this->settlement->apply($this->w->company, $this->invoice['id'], '50.00', 'BANK-1');
    expect($again->replayed)->toBeTrue()->and($again->balanceDue)->toBe('70.0000');

    expect(fn () => $this->settlement->apply($this->w->company, $this->invoice['id'], '10', 'BANK-1'))->toThrow(ValidationException::class);
    expect(fn () => $this->settlement->apply($this->w->company, $this->invoice['id'], '70.01', 'BANK-2'))->toThrow(ValidationException::class);
    expect(fn () => $this->settlement->apply($this->w->company, $this->invoice['id'], '0', 'BANK-3'))->toThrow(ValidationException::class);
    expect(fn () => $this->settlement->apply($this->w->company, $this->invoice['id'], '1.00001', 'BANK-3'))->toThrow(ValidationException::class);

    $paid = $this->settlement->apply($this->w->company, $this->invoice['id'], '70', 'BANK-2');
    expect($paid->status)->toBe('paid')->and($paid->balanceDue)->toBe('0.0000');
    expect(fn () => $this->settlement->apply($this->w->company, $this->invoice['id'], '1', 'BANK-4'))->toThrow(ValidationException::class);

    $undo = $this->settlement->unapply($this->w->company, $this->invoice['id'], 'BANK-1');
    expect($undo->status)->toBe('partially_paid')->and($undo->paidAmount)->toBe('70.0000')->and($undo->balanceDue)->toBe('50.0000');
    expect($this->settlement->unapply($this->w->company, $this->invoice['id'], 'BANK-1')->replayed)->toBeTrue();
    expect(fn () => $this->settlement->unapply($this->w->company, $this->invoice['id'], 'NOPE'))->toThrow(ValidationException::class);

    $this->settlement->unapply($this->w->company, $this->invoice['id'], 'BANK-2');
    expect(DB::table('sales_invoices')->where('id', $this->invoice['id'])->value('status'))->toBe('issued');

    // A paid invoice cannot be reversed.
    $this->settlement->apply($this->w->company, $this->invoice['id'], '5', 'BANK-5');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/reverse", ['reason' => 'x'])->assertStatus(422);
});

it('does not settle drafts, credit notes of other companies or unknown invoices', function (): void {
    $other = SalesKit::company();
    expect(fn () => $this->settlement->apply($other, $this->invoice['id'], '1', 'X'))->toThrow(ValidationException::class);
    expect(fn () => $this->settlement->apply($this->w->company, (string) Str::uuid7(), '1', 'X'))->toThrow(ValidationException::class);

    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->json('data');
    expect(fn () => $this->settlement->apply($this->w->company, $draft['id'], '1', 'X'))->toThrow(ValidationException::class);
});

it('looks invoices up and lists the open ones of a party, oldest due first', function (): void {
    $lookup = app(SalesInvoiceLookup::class);
    $data = SalesKit::in($this->w->company, fn () => $lookup->find($this->invoice['id']));

    expect($data->number)->toBe('INV2027000000001')->and($data->total)->toBe('120.0000')->and($data->balanceDue)->toBe('120.0000')
        ->and($data->dueDate)->toBe('2027-07-10')->and($data->partyId)->toBe($this->w->party->id)->and($data->invoiceType)->toBe('sale');

    $open = $lookup->openForParty($this->w->company, $this->w->party->id);
    expect($open)->toHaveCount(1)->and($open[0]->id)->toBe($this->invoice['id']);

    // Another company sees nothing.
    $other = SalesKit::company();
    expect(SalesKit::in($other, fn () => $lookup->find($this->invoice['id'])))->toBeNull()
        ->and($lookup->openForParty($other, $this->w->party->id))->toBe([]);
});

it('exposes the customer exposure through the contract', function (): void {
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '500', 'risk_currency_code' => 'TRY']);
    $this->settlement->apply($this->w->company, $this->invoice['id'], '20', 'BANK-1');
    SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '50']]);

    $exposure = app(CustomerExposure::class)->exposure($this->w->company, $this->w->party->id);
    expect($exposure->openInvoices)->toBe('100.00')->and($exposure->openOrders)->toBe('60.00')
        ->and($exposure->total)->toBe('160.00')->and($exposure->limit)->toBe('500.00')->and($exposure->available)->toBe('340.00')
        ->and($exposure->currency)->toBe('TRY');
});
