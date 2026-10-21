<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
});

function salesQuotePayload(object $w, array $line = [], array $header = []): array
{
    return ['party_id' => $w->party->id, 'document_date' => '2027-06-10', ...$header, 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', ...$line]]];
}

it('prices lines through the resolver and records the source', function (): void {
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w))
        ->assertCreated()
        ->assertJsonPath('data.lines.0.unit_price', '120.000000')
        ->assertJsonPath('data.lines.0.price_source', 'default_price_list')
        ->assertJsonPath('data.lines.0.tax_rate', '20.0000')
        ->assertJsonPath('data.lines.0.tax_code_id', $this->w->vat->id)
        ->assertJsonPath('data.total', '288.0000');
});

it('refuses a price override without sales.price_override and audits an allowed one', function (): void {
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['unit_price' => '99']))
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.unit_price']));

    // The same price as the resolver's is not an override.
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['unit_price' => '120.00']))->assertCreated();

    $boss = SalesKit::user(['sales.price_override']);
    $quote = SalesKit::post($boss, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['unit_price' => '99']))
        ->assertCreated()->assertJsonPath('data.lines.0.price_source', 'manual')->json('data');
    expect(DB::table('activity_log')->where('subject_id', $quote['id'])->where('event', 'price_override')->exists())->toBeTrue();
});

it('accepts manual prices when no price list applies and requires one otherwise', function (): void {
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.unit_price']));

    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '75']],
    ])->assertCreated()->assertJsonPath('data.lines.0.price_source', 'manual')->assertJsonPath('data.total', '90.0000');
});

it('snapshots the tax rate valid on the document date', function (): void {
    $old = SalesKit::taxCode($this->w->company, '18.0000', '2023-01-01', '2027-06-30');
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['tax_code_id' => $old->id]))
        ->assertCreated()->assertJsonPath('data.lines.0.tax_rate', '18.0000')->assertJsonPath('data.tax_total', '43.2000')->json('data');

    // A later change of the code does not touch the stored document.
    DB::table('tax_codes')->where('id', $old->id)->update(['rate' => '25.0000']);
    SalesKit::get($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}")->assertJsonPath('data.lines.0.tax_rate', '18.0000');

    // After its validity the code cannot be used.
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['tax_code_id' => $old->id], ['document_date' => '2027-07-05']))
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.tax_code_id']));

    // An explicit null leaves the line untaxed.
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['tax_code_id' => null]))
        ->assertCreated()->assertJsonPath('data.tax_total', '0.0000');
});

it('converts units to the base quantity', function (): void {
    $box = SalesKit::unit($this->w->company, 'BOX');
    Catalog::itemUnit($this->w->company, $this->w->item, $box, '12');
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['unit_id' => $box->id, 'unit_price' => '1440']))
        ->assertCreated()->assertJsonPath('data.lines.0.base_quantity', '24.000000')->assertJsonPath('data.lines.0.quantity', '2.000000');
});

it('walks the quote lifecycle and refuses illegal transitions', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w))->json('data');

    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}", ['version' => 1, 'notes' => 'Edited'])
        ->assertOk()->assertJsonPath('data.notes', 'Edited')->assertJsonPath('data.version', 2);
    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}", ['version' => 1, 'notes' => 'Stale'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');

    $sent = SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/send")->assertOk()->assertJsonPath('data.status', 'sent')->json('data');
    expect($sent['number'])->toBe('QUO2027000000001');

    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}", ['version' => $sent['version'], 'notes' => 'x'])
        ->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-quotes/{$quote['id']}")->assertStatus(422);

    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/reject", ['reason' => 'Too expensive'])
        ->assertOk()->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.rejection_reason', 'Too expensive');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/accept")
        ->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/convert")
        ->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');

    $revision = SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/revise")->assertCreated()
        ->assertJsonPath('data.revision', 2)->assertJsonPath('data.previous_revision_id', $quote['id'])->assertJsonPath('data.status', 'draft')->json('data');
    SalesKit::get($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}")
        ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.links.next_revisions.0.id', $revision['id']);

    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$revision['id']}/accept")->assertOk()->assertJsonPath('data.status', 'accepted');
    $order = SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$revision['id']}/convert", ['requested_delivery_date' => '2027-06-30'])
        ->assertCreated()->assertJsonPath('data.source_type', 'sales_quote')->assertJsonPath('data.quote_id', $revision['id'])
        ->assertJsonPath('data.requested_delivery_date', '2027-06-30')->assertJsonPath('data.lines.0.price_source', 'source')->json('data');
    expect($order['lines'][0]['source_line_id'])->toBe($revision['lines'][0]['id']);

    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$revision['id']}/convert")->assertStatus(422);
});

it('converting needs sales.orders.create as well', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w))->json('data');
    $quoter = Actors::user(['sales.quotes.view', 'sales.quotes.update']);
    SalesKit::post($quoter, $this->w->company, "sales-quotes/{$quote['id']}/convert")->assertForbidden();
    expect(DB::table('sales_quotes')->where('id', $quote['id'])->value('status'))->toBe('draft');
});

it('expires quotes past their validity and refuses to convert them', function (): void {
    $quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, [], ['valid_until' => '2027-06-14']))
        ->assertJsonPath('data.valid_until', '2027-06-14')->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/convert")
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['valid_until']));

    Artisan::call('sales:expire-quotes', ['--company' => $this->w->company]);
    expect(DB::table('sales_quotes')->where('id', $quote['id'])->value('status'))->toBe('expired');
});

it('previews totals without storing anything and reports an unauthorized override as a warning', function (): void {
    $res = SalesKit::post($this->w->user, $this->w->company, 'sales-documents/preview-totals', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10',
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '3'], ['item_id' => $this->w->item->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->assertOk()
        ->assertJsonPath('data.lines.0.unit_price', '120.000000')
        ->assertJsonPath('data.lines.0.pricing.source', 'default_price_list')
        ->assertJsonPath('data.lines.1.price_source', 'manual')
        ->assertJsonPath('data.totals.total', '552.00')
        ->assertJsonPath('data.taxes.0.tax', '92.00')
        ->assertJsonPath('meta.warnings.0.code', 'sales.price_override_forbidden');
    expect($res->json('data.price_overrides.0.resolved'))->toBe('120.000000')
        ->and(DB::table('sales_quotes')->count())->toBe(0);

    SalesKit::post(Actors::user(['sales.quotes.view']), $this->w->company, 'sales-documents/preview-totals', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1']],
    ])->assertForbidden();
});

it('validates parties: unknown, inactive or not a customer', function (): void {
    $supplier = SalesKit::party($this->w->company, ['roles' => ['supplier']]);
    $inactive = SalesKit::party($this->w->company, ['is_active' => false]);

    foreach ([(string) Str::uuid7(), $supplier->id, $inactive->id] as $party) {
        SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [...salesQuotePayload($this->w), 'party_id' => $party])
            ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['party_id']));
    }
});

it('rejects more than 500 lines and non-positive quantities', function (): void {
    $lines = array_fill(0, 501, ['item_id' => $this->w->item->id, 'quantity' => '1']);
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', ['party_id' => $this->w->party->id, 'lines' => $lines])->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['quantity' => '0']))
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.quantity']));
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', salesQuotePayload($this->w, ['quantity' => '-1']))->assertStatus(422);
});
