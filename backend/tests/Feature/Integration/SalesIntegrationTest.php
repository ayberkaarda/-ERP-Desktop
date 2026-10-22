<?php

declare(strict_types=1);

use App\Models\User;
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

it('names the company on the print model for a platform admin without a membership', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '100']]);
    $admin = User::factory()->create(['is_super_admin' => true]);
    $name = DB::table('companies')->where('id', $this->w->company)->value('name');

    SalesKit::get($admin, $this->w->company, "sales-orders/{$order['id']}/print-model")->assertOk()
        ->assertJsonPath('data.company.id', $this->w->company)->assertJsonPath('data.company.name', $name);
});

it('rechecks the limit when an invoice of order value confirmed without an override is issued', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'off');
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '1000']]);
    $invoice = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices", ['document_date' => '2027-06-12'])
        ->assertCreated()->json('data');
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '500']);

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded')->assertJsonPath('errors.details.document', '0.00')
        ->assertJsonPath('errors.details.total', '1200.00');

    $approver = SalesKit::user(['sales.credit_override']);
    SalesKit::post($approver, $this->w->company, "sales-invoices/{$invoice['id']}/issue", ['credit_override_reason' => 'Collateral received'])
        ->assertOk()->assertJsonPath('data.status', 'issued')->assertJsonPath('data.credit_override_reason', 'Collateral received');
});

/** A draft order converted from a quote of one manually priced widget line (no price list). */
function salesConvertedDraft(object $w): array
{
    $quote = SalesKit::post($w->user, $w->company, 'sales-quotes', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '75', 'discount_percent' => '10']],
    ])->assertCreated()->json('data');

    return SalesKit::post($w->user, $w->company, "sales-quotes/{$quote['id']}/convert")->assertCreated()->json('data');
}

it('keeps line identity, provenance and copied prices when a converted draft order is saved', function (): void {
    $order = salesConvertedDraft($this->w);
    $line = $order['lines'][0];
    expect($line['source_line_id'])->not->toBeNull()->and($line['price_source'])->toBe('source');

    // Header-only save.
    $saved = SalesKit::patch($this->w->user, $this->w->company, "sales-orders/{$order['id']}", ['notes' => 'n', 'version' => $order['version']])
        ->assertOk()->json('data');
    expect($saved['lines'][0])->toMatchArray(['id' => $line['id'], 'source_line_id' => $line['source_line_id'], 'price_source' => 'source', 'unit_price' => $line['unit_price']]);

    // Quantity edit of the kept line (no price sent) plus a new line.
    $edited = SalesKit::patch($this->w->user, $this->w->company, "sales-orders/{$order['id']}", ['version' => $saved['version'], 'lines' => [
        ['id' => $line['id'], 'item_id' => $this->w->item->id, 'quantity' => '3', 'unit_price' => null, 'discount_percent' => '10'],
        ['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '20'],
    ]])->assertOk()->json('data');
    expect($edited['lines'][0])->toMatchArray(['id' => $line['id'], 'source_line_id' => $line['source_line_id'], 'price_source' => 'source', 'unit_price' => $line['unit_price'], 'quantity' => '3.000000'])
        ->and($edited['lines'][1]['id'])->not->toBe($line['id'])
        ->and($edited['lines'][1]['source_line_id'])->toBeNull();

    // Another item on the kept line drops the provenance.
    $swapped = SalesKit::patch($this->w->user, $this->w->company, "sales-orders/{$order['id']}", ['version' => $edited['version'], 'lines' => [
        ['id' => $line['id'], 'item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '30'],
    ]])->assertOk()->json('data');
    expect($swapped['lines'][0]['source_line_id'])->toBeNull()->and($swapped['lines'][0]['price_source'])->toBe('manual');
});

it('refuses a line id that is not a line of the edited document', function (): void {
    $order = salesConvertedDraft($this->w);
    $other = salesConvertedDraft($this->w);

    SalesKit::patch($this->w->user, $this->w->company, "sales-orders/{$order['id']}", ['version' => $order['version'], 'lines' => [
        ['id' => $other['lines'][0]['id'], 'item_id' => $this->w->item->id, 'quantity' => '1'],
    ]])->assertStatus(422)->assertJsonValidationErrors(['lines.0.id'], 'errors.fields');
});

it('lists the shipped serials a return can still take on the invoice detail', function (): void {
    $serial = SalesKit::item($this->w->company, ['code' => 'PHONE', 'tracking' => 'serial', 'default_tax_code_id' => $this->w->vat->id], $this->w->unit);
    SalesKit::receive($this->w->company, $this->w->wh->id, $serial->id, '3', '100', ['serials' => ['S1', 'S2', 'S3']]);
    $order = SalesKit::confirmedOrder($this->w, [[$serial->id, '2', '300'], [$this->w->service->id, '1', '10']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", [
        'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '2', 'serial_numbers' => ['S1', 'S2']]],
    ])->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk();
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $line = $invoice['lines'][0]['id'];

    SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}")->assertOk()
        ->assertJsonPath('data.lines.0.returnable_serials', ['S1', 'S2']);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $line, 'quantity' => '1', 'serial_numbers' => ['S2']]],
    ])->assertCreated()->json('data');
    SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}")->assertJsonPath('data.lines.0.returnable_serials', ['S1']);

    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/cancel")->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}")->assertJsonPath('data.lines.0.returnable_serials', ['S1', 'S2']);
});

it('does not let an invoice inherit an override recorded for another customer before a revision', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100']);
    $b = SalesKit::party($this->w->company, ['name' => 'Beta']);
    DB::table('parties')->where('id', $b->id)->update(['risk_limit' => '2000', 'risk_currency_code' => 'TRY']);
    $admin = SalesKit::user(['sales.credit_override']);
    $order = SalesKit::post($admin, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1000']],
    ])->assertCreated()->json('data');
    $order = SalesKit::post($admin, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Guarantee for Acme'])
        ->assertOk()->json('data');

    // An approver without the override permission moves the order to Beta, who still has room.
    $approver = SalesKit::user();
    $revised = SalesKit::post($approver, $this->w->company, "sales-orders/{$order['id']}/revise", [
        'party_id' => $b->id, 'version' => $order['version'],
    ])->assertOk()->json('data');
    expect($revised['party_id'])->toBe($b->id)->and($revised['credit_override_reason'])->toBeNull();

    DB::table('parties')->where('id', $b->id)->update(['risk_limit' => '500']);
    $invoice = SalesKit::post($approver, $this->w->company, "sales-orders/{$order['id']}/invoices", ['document_date' => '2027-06-12'])
        ->assertCreated()->json('data');
    SalesKit::post($approver, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
});

it('does not let an invoice inherit an override once the exposure grew beyond what it authorised', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100']);
    $admin = SalesKit::user(['sales.credit_override']);
    $order = SalesKit::post($admin, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1000']],
    ])->assertCreated()->json('data');
    SalesKit::post($admin, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Guarantee for 1200'])->assertOk();

    // Another document raises the exposure later (its own override).
    $direct = SalesKit::post($admin, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-11',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '500']],
    ])->assertCreated()->json('data');
    SalesKit::post($admin, $this->w->company, "sales-invoices/{$direct['id']}/issue", ['credit_override_reason' => 'Separate approval'])->assertOk();

    $plain = SalesKit::user();
    $invoice = SalesKit::post($plain, $this->w->company, "sales-orders/{$order['id']}/invoices", ['document_date' => '2027-06-12'])
        ->assertCreated()->json('data');
    SalesKit::post($plain, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertStatus(422)
        ->assertJsonPath('errors.code', 'sales.credit_limit_exceeded');
});

it('binds an override of a converted order to that order and lets its partial invoices inherit it', function (): void {
    SalesKit::setting($this->w->company, 'sales.credit_check_mode', 'block');
    DB::table('parties')->where('id', $this->w->party->id)->update(['risk_limit' => '100']);
    $admin = SalesKit::user(['sales.credit_override']);
    $quote = SalesKit::post($admin, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '2', 'unit_price' => '500']],
    ])->assertCreated()->json('data');
    $order = SalesKit::post($admin, $this->w->company, "sales-quotes/{$quote['id']}/convert")->assertCreated()->json('data');
    expect($order['credit_override_reason'])->toBeNull();
    SalesKit::post($admin, $this->w->company, "sales-orders/{$order['id']}/confirm")->assertStatus(422);
    $order = SalesKit::post($admin, $this->w->company, "sales-orders/{$order['id']}/confirm", ['credit_override_reason' => 'Guarantee letter'])
        ->assertOk()->json('data');
    expect(DB::table('sales_orders')->where('id', $order['id'])->first(['credit_override_party_id', 'credit_override_revision', 'credit_override_amount', 'credit_override_exposure']))
        ->toEqual((object) ['credit_override_party_id' => $this->w->party->id, 'credit_override_revision' => 1, 'credit_override_amount' => '1200.0000', 'credit_override_exposure' => '1200.0000']);

    $plain = SalesKit::user();
    foreach ([1, 2] as $n) {
        $invoice = SalesKit::post($plain, $this->w->company, "sales-orders/{$order['id']}/invoices", [
            'document_date' => '2027-06-12', 'lines' => [['order_line_id' => $order['lines'][0]['id'], 'quantity' => '1']],
        ])->assertCreated()->json('data');
        SalesKit::post($plain, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()
            ->assertJsonPath('data.credit_override_reason', 'Guarantee letter');
    }
});
