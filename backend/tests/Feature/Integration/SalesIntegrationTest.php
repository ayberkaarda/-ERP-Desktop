<?php

declare(strict_types=1);

use App\Modules\Files\Models\File;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

const SALES_ATTACHMENT_PNG = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82";

beforeEach(function (): void {
    $this->w = SalesKit::world();
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '1500', 'risk_currency_code' => 'TRY']);
});

/** A confirmed service order of 1000 + 20% VAT and a draft invoice of all of it. */
function salesOrderAndDraftInvoice(object $w): array
{
    $order = SalesKit::confirmedOrder($w, [[$w->service->id, '1', '1000']]);
    $invoice = SalesKit::post($w->user, $w->company, "sales-orders/{$order['id']}/invoices", ['document_date' => '2027-06-12'])
        ->assertCreated()->json('data');

    return [$order, $invoice];
}

it('returns no document amount on the exposure without document_id', function (): void {
    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure")
        ->assertOk()->assertJsonPath('data.limit', '1500.00')->assertJsonPath('data.document_amount', null);
});

it('reports what a draft invoice adds to the exposure, less the open order value it replaces', function (): void {
    [$order, $invoice] = salesOrderAndDraftInvoice($this->w);

    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure?document_id={$invoice['id']}")
        ->assertOk()->assertJsonPath('data.open_orders', '1200.00')->assertJsonPath('data.document_amount', '0.00');

    $direct = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-12',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '500']],
    ])->assertCreated()->json('data');

    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure?document_id={$direct['id']}")
        ->assertOk()->assertJsonPath('data.document_amount', '600.00');
    // A draft order is not in the exposure yet: its whole total is what confirming adds.
    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-12',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '2', 'unit_price' => '100']],
    ])->assertCreated()->json('data');
    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure?document_id={$draft['id']}")
        ->assertOk()->assertJsonPath('data.document_amount', '240.00');
    expect($order['status'])->toBe('confirmed');
});

it('does not warn about the credit limit on a draft invoice that only replaces open order value', function (): void {
    [, $invoice] = salesOrderAndDraftInvoice($this->w);

    SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}")->assertOk()->assertJsonPath('data.warnings', []);
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()
        ->assertJsonPath('data.status', 'issued')->assertJsonMissingPath('meta.warnings');
});

it('refuses a document of another customer or company and one the caller may not view', function (): void {
    [, $invoice] = salesOrderAndDraftInvoice($this->w);
    $other = SalesKit::party($this->w->company, ['name' => 'Other']);

    SalesKit::get($this->w->user, $this->w->company, "customers/{$other->id}/exposure?document_id={$invoice['id']}")
        ->assertStatus(422)->assertJsonValidationErrors(['document_id'], 'errors.fields');
    SalesKit::get($this->w->user, $this->w->company, "customers/{$this->w->party->id}/exposure?document_id=nope")
        ->assertStatus(422)->assertJsonValidationErrors(['document_id'], 'errors.fields');

    $quotesOnly = Actors::user(['sales.quotes.view']);
    SalesKit::get($quotesOnly, $this->w->company, "customers/{$this->w->party->id}/exposure")->assertOk();
    SalesKit::get($quotesOnly, $this->w->company, "customers/{$this->w->party->id}/exposure?document_id={$invoice['id']}")->assertForbidden();

    $foreign = Actors::companyFor($this->w->user, SalesKit::ALL);
    SalesKit::get($this->w->user, $foreign, "customers/{$this->w->party->id}/exposure?document_id={$invoice['id']}")->assertNotFound();
});

it('accepts attachments on every sales document type by morph alias', function (): void {
    Storage::fake('local');
    [$order, $invoice] = salesOrderAndDraftInvoice($this->w);
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->assertCreated()->json('data');
    $stock = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $stock['id'], [$stock['lines'][0]['id'] => '2']);
    $issued = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$issued['id']}/returns", ['document_date' => '2027-06-14'])
        ->assertCreated()->json('data');
    $user = Actors::user(['files.view', 'files.create']);

    foreach (['sales_quote' => $quote, 'sales_order' => $order, 'sales_delivery' => $delivery, 'sales_invoice' => $invoice, 'sales_return' => $return] as $alias => $doc) {
        SalesKit::as($user, $this->w->company)->withHeaders(['Idempotency-Key' => (string) Str::uuid7()])
            ->post('/api/v1/files', ['file' => UploadedFile::fake()->createWithContent('scan.png', SALES_ATTACHMENT_PNG), 'attachable_type' => $alias, 'attachable_id' => $doc['id']])
            ->assertCreated()->assertJsonPath('data.attachable_type', $alias)->assertJsonPath('data.attachable_id', $doc['id']);
    }

    // Another company's document is refused.
    $foreign = Actors::companyFor($user, ['files.view', 'files.create']);
    SalesKit::as($user, $foreign)->withHeaders(['Idempotency-Key' => (string) Str::uuid7()])
        ->post('/api/v1/files', ['file' => UploadedFile::fake()->createWithContent('scan.png', SALES_ATTACHMENT_PNG), 'attachable_type' => 'sales_invoice', 'attachable_id' => $invoice['id']])
        ->assertStatus(422);
    expect(File::query()->withoutCompanyScope()->count())->toBe(5);
});

it('issues an invoice of overridden order value without asking for another override', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    $this->w->user = SalesKit::user(['sales.credit_override']);
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '1000']);
    $order = SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1000']],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Guarantee letter received'])
        ->assertOk()->assertJsonPath('data.status', 'confirmed');

    $invoice = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices", ['document_date' => '2027-06-12'])
        ->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()
        ->assertJsonPath('data.status', 'issued');

    // A new direct invoice adds exposure and is still blocked.
    $direct = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-12',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$direct['id']}/issue")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
});
