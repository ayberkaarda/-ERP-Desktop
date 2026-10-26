<?php

declare(strict_types=1);

use App\Modules\Purchasing\Events\PurchaseInvoiceBooked;
use App\Modules\Purchasing\Events\PurchaseOrderApproved;
use App\Modules\Purchasing\Events\PurchaseReceiptPosted;
use App\Modules\Purchasing\Events\PurchaseReturnDebited;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Support\Inventory\Inv;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
});

it('runs order -> receipt -> invoice -> return -> debit note with stock, journals and events in step', function (): void {
    Event::fake([PurchaseOrderApproved::class, PurchaseReceiptPosted::class, PurchaseInvoiceBooked::class, PurchaseReturnDebited::class]);
    $w = $this->w;

    $order = PurchKit::post($w->user, $w->company, 'purchase-orders', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'expected_date' => '2027-06-20',
        'lines' => [
            ['item_id' => $w->item->id, 'quantity' => '10', 'unit_price' => '50'],
            ['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '200'],
        ],
    ])->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.subtotal', '700.0000')
        ->assertJsonPath('data.tax_total', '140.0000')
        ->assertJsonPath('data.total', '840.0000')
        ->json('data');

    $approved = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/submit")->assertOk()
        ->assertJsonPath('data.status', 'approved')->json('data');
    expect($approved['number'])->toStartWith('POR2027');
    Event::assertDispatched(PurchaseOrderApproved::class);
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/send")->assertOk()->assertJsonPath('data.status', 'sent');

    $stockLine = $approved['lines'][0];
    $receipt = PurchKit::receive($w, $order['id'], [$stockLine['id'] => '6']);
    expect($receipt['status'])->toBe('posted')
        ->and($receipt['number'])->toStartWith('GRN2027')
        ->and($receipt['cost_total'])->toBe('300.0000')
        ->and($receipt['lines'][0]['unit_cost'])->toBe('50.000000')
        ->and(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('6.000000');
    Event::assertDispatched(PurchaseReceiptPosted::class);
    // Dr 153 / Cr 381 at the order cost.
    expect(PurchKit::journal($receipt['journal_entry_id']))->toBe([
        '153' => ['debit' => '300.00', 'credit' => '0.00'],
        '381' => ['debit' => '0.00', 'credit' => '300.00'],
    ]);
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")
        ->assertJsonPath('data.status', 'partially_received')
        ->assertJsonPath('data.lines.0.received_quantity', '6.000000');

    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'A-1001');
    expect($invoice['status'])->toBe('booked')
        ->and($invoice['number'])->toStartWith('PIN2027')
        ->and($invoice['total'])->toBe('360.0000')
        ->and($invoice['balance_due'])->toBe('360.0000')
        ->and($invoice['match_status'])->toBe('matched');
    Event::assertDispatched(PurchaseInvoiceBooked::class);
    expect(PurchKit::journal($invoice['journal_entry_id']))->toBe([
        '191' => ['debit' => '60.00', 'credit' => '0.00'],
        '320' => ['debit' => '0.00', 'credit' => '360.00'],
        '381' => ['debit' => '300.00', 'credit' => '0.00'],
    ]);
    expect(PurchKit::balance($w->company, '381'))->toBe('0.0000');

    // The service line is invoiced from the order: Dr expense.
    $serviceInvoice = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/invoices", [
        'document_date' => '2027-06-14', 'supplier_invoice_no' => 'A-1002', 'lines' => [['order_line_id' => $approved['lines'][1]['id'], 'quantity' => '1']],
    ])->assertCreated()->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$serviceInvoice['id']}/book")->assertOk()->json('data');
    expect(PurchKit::journal($booked['journal_entry_id']))->toBe([
        '191' => ['debit' => '40.00', 'credit' => '0.00'],
        '320' => ['debit' => '0.00', 'credit' => '240.00'],
        '770' => ['debit' => '200.00', 'credit' => '0.00'],
    ]);
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'partially_invoiced');

    // Return 2 of the invoiced 6 and debit them.
    $return = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/returns", [
        'document_date' => '2027-06-15', 'reason' => 'Damaged', 'lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '2']],
    ])->assertCreated()->assertJsonPath('data.status', 'draft')->json('data');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk()->assertJsonPath('data.status', 'approved');
    $shipped = PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk()
        ->assertJsonPath('data.status', 'shipped')->assertJsonPath('data.lines.0.cost_total', '100.0000')
        ->assertJsonPath('data.lines.0.receipt_cost', '100.0000')->json('data');
    expect(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('4.000000')
        ->and($shipped['number'])->toStartWith('PRT2027');
    $debited = PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/debit")->assertOk()
        ->assertJsonPath('data.status', 'debited')->json('data');
    Event::assertDispatched(PurchaseReturnDebited::class);
    $debit = PurchKit::get($w->user, $w->company, "purchase-invoices/{$debited['debit_invoice_id']}")->assertOk()
        ->assertJsonPath('data.document_type', 'purchase_debit_note')->assertJsonPath('data.status', 'booked')
        ->assertJsonPath('data.total', '120.0000')->json('data');
    expect($debit['number'])->toStartWith('PDN2027')
        ->and(PurchKit::journal($debit['journal_entry_id']))->toBe([
            '191' => ['debit' => '0.00', 'credit' => '20.00'],
            '320' => ['debit' => '120.00', 'credit' => '0.00'],
            '381' => ['debit' => '0.00', 'credit' => '100.00'],
        ]);

    // Ledger reconciles: payable = 360 + 240 - 120, accrual cleared, stock = 4 x 50.
    expect(PurchKit::balance($w->company, '320'))->toBe('-480.0000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and(PurchKit::balance($w->company, '153'))->toBe('200.0000')
        ->and(PurchKit::balance($w->company, '191'))->toBe('80.0000')
        ->and(Inv::valuation($w->company, $w->item->id, $w->wh->id)['value'])->toStartWith('200.');

    $links = PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->json('data.links');
    expect($links['receipts'])->toHaveCount(1)->and($links['invoices'])->toHaveCount(2);
    expect(DB::table('journal_entries')->where('company_id', $w->company)->count())->toBeGreaterThan(4);
});
