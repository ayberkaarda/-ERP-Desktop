<?php

declare(strict_types=1);

use App\Modules\Purchasing\Contracts\PayableSettlement;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Purchasing\Contracts\SupplierExposure;
use App\Modules\Purchasing\Contracts\SupplierPerformance;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->order = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '10', '10']], ['expected_date' => '2027-06-12']);
    $this->receipt = PurchKit::receive($this->w, $this->order['id'], [$this->order['lines'][0]['id'] => '6']);
    $this->invoice = PurchKit::invoiceReceipt($this->w, $this->receipt['id'], 'C-1', ['due_date' => '2027-06-14']);
});

it('computes the supplier exposure: open payables plus approved, not invoiced order value', function (): void {
    $exposure = app(SupplierExposure::class)->exposure($this->w->company, $this->w->party->id);

    // Invoice 6 x 10 + 20% = 72 open; order line 120 total, 4 of 10 not invoiced = 48.
    expect($exposure->openPayables)->toBe('72.00')
        ->and($exposure->openOrders)->toBe('48.00')
        ->and($exposure->total)->toBe('120.00')
        ->and($exposure->overduePayables)->toBe('72.00')
        ->and($exposure->currency)->toBe('TRY');
    PurchKit::get($this->w->user, $this->w->company, "suppliers/{$this->w->party->id}/exposure")->assertOk()
        ->assertJsonPath('data.open_payables', '72.00')->assertJsonPath('data.total', '120.00');
    PurchKit::get($this->w->user, $this->w->company, "suppliers/{$this->w->party->id}/purchase-summary")->assertOk()
        ->assertJsonPath('data.invoices.count', 1)->assertJsonPath('data.invoices.invoiced_total', '72.00')
        ->assertJsonPath('data.invoices.balance_due', '72.00')->assertJsonPath('data.orders.open_count', 1);
});

it('looks invoices up and settles payables idempotently by reference', function (): void {
    $lookup = app(PurchaseInvoiceLookup::class);
    $settlement = app(PayableSettlement::class);
    $data = $lookup->find($this->invoice['id']);
    expect($data?->number)->toBe($this->invoice['number'])
        ->and($data?->supplierInvoiceNo)->toBe('C-1')
        ->and($data?->balanceDue)->toBe('72.0000')
        ->and($lookup->openForParty($this->w->company, $this->w->party->id))->toHaveCount(1);

    $partial = $settlement->apply($this->w->company, $this->invoice['id'], '30', 'PAY-1');
    expect($partial->status)->toBe('partially_paid')->and($partial->balanceDue)->toBe('42.0000')->and($partial->replayed)->toBeFalse();
    expect($settlement->apply($this->w->company, $this->invoice['id'], '30', 'PAY-1')->replayed)->toBeTrue();
    expect(fn () => $settlement->apply($this->w->company, $this->invoice['id'], '31', 'PAY-1'))->toThrow(ValidationException::class);
    expect(fn () => $settlement->apply($this->w->company, $this->invoice['id'], '43', 'PAY-2'))->toThrow(ValidationException::class);

    $paid = $settlement->apply($this->w->company, $this->invoice['id'], '42', 'PAY-2');
    expect($paid->status)->toBe('paid')->and($paid->balanceDue)->toBe('0.0000')
        ->and($lookup->openForParty($this->w->company, $this->w->party->id))->toBe([]);
    // A paid invoice cannot be reversed; unapplying reopens it.
    PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$this->invoice['id']}/reverse", ['reason' => 'x'])->assertStatus(422);
    $back = $settlement->unapply($this->w->company, $this->invoice['id'], 'PAY-2');
    expect($back->status)->toBe('partially_paid')->and($back->balanceDue)->toBe('42.0000')
        ->and($settlement->unapply($this->w->company, $this->invoice['id'], 'PAY-2')->replayed)->toBeTrue();
});

it('settles the payable net of withheld VAT', function (): void {
    $w = $this->w;
    $invoice = PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'supplier_invoice_no' => 'WH-9',
        'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100', 'withholding_code_id' => $w->withholding->id]],
    ])->json('data');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->assertJsonPath('data.balance_due', '110.0000');
    $paid = app(PayableSettlement::class)->apply($w->company, $invoice['id'], '110', 'PAY-W');
    expect($paid->status)->toBe('paid');
});

it('reports supplier performance: on time, fill, lead time, variance, returns, overdue', function (): void {
    $w = $this->w;
    // A late receipt of the rest (expected 2027-06-12).
    PurchKit::receive($w, $this->order['id'], [$this->order['lines'][0]['id'] => '4'], '2027-06-14');
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$this->invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $this->invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->json('data');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk();

    $performance = app(SupplierPerformance::class)->forParty($w->company, $w->party->id, new DateTimeImmutable('2027-01-01'), new DateTimeImmutable('2027-12-31'));
    expect($performance->orders)->toBe(1)
        ->and($performance->onTimeRate)->toBe('0.5000')
        ->and($performance->fillRate)->toBe('1.0000')
        ->and($performance->avgLeadDays)->toBe('2.00')
        ->and($performance->priceVarianceTotal)->toBe('0.00')
        ->and($performance->returnRate)->toBe('0.1000')
        ->and($performance->overduePayable)->toBe('72.00');
    PurchKit::get($w->user, $w->company, "suppliers/{$w->party->id}/performance?from=2027-01-01&to=2027-12-31")->assertOk()
        ->assertJsonPath('data.on_time_rate', '0.5000')->assertJsonPath('data.orders', 1);
    PurchKit::get($w->user, $w->company, "suppliers/{$w->party->id}/performance?from=2027-12-31&to=2027-01-01")->assertStatus(422);
});

it('keeps contracts inside the active company', function (): void {
    $other = Actors::companyFor($this->w->user, PurchKit::ALL);
    expect(PurchKit::in($other, fn () => app(PurchaseInvoiceLookup::class)->find($this->invoice['id'])))->toBeNull()
        ->and(app(PurchaseInvoiceLookup::class)->openForParty($other, $this->w->party->id))->toBe([]);
    expect(fn () => app(PayableSettlement::class)->apply($other, $this->invoice['id'], '1', 'X'))->toThrow(ValidationException::class);
    PurchKit::get($this->w->user, $other, "suppliers/{$this->w->party->id}/exposure")->assertNotFound();
    expect(DB::table('purchase_payable_applications')->count())->toBe(0);
});

it('reads other modules only through their contracts', function (): void {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Modules/Purchasing')));
    $offenders = [];

    foreach ($files as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $code = (string) file_get_contents($file->getPathname());

            if (preg_match("/(table|join|joinSub)\\('(payment_terms|party_addresses|parties|stock_[a-z_]+|items|warehouses|tax_codes|journal_[a-z_]+|accounts|sales_[a-z_]+)\\b/", $code) === 1) {
                $offenders[] = $file->getFilename();
            }
        }
    }

    expect($offenders)->toBe([]);
});
