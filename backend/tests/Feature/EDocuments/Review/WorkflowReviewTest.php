<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Services\Documents;
use App\Modules\Purchasing\Services\InvoiceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\EDocuments\Core\FakeXml;
use Tests\Support\Actors;
use Tests\Support\EDocuments\EdocKit;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = EdocKit::world();
    $w = $this->w;
    app(CompanyContext::class)->set($w->company);
    $fake = new FakeXml;
    app()->instance(DocumentXml::class, $fake);
    $this->fake = $fake;
    $fake->incoming = XmlDocumentSnapshot::fromArray(['kind' => 'e_invoice', 'profile' => 'TICARIFATURA', 'invoice_type' => 'SATIS', 'uuid' => (string) Str::uuid7(), 'number' => 'INC'.gmdate('Y').'000000001', 'issue_date' => $w->day, 'currency' => 'TRY', 'supplier' => ['name' => 'Supplier', 'tax_number' => '9876543210'], 'customer' => ['name' => 'Keystone', 'tax_number' => '1234567890'], 'totals' => ['total' => '240.00'], 'lines' => [], 'metadata' => []]);
    $this->doc = app(Documents::class)->import($w->user, '<fixture/>');
    $w->party->roles = ['customer', 'supplier'];
    $w->party->save();
    $this->purchase = app(InvoiceService::class)->create(['party_id' => $w->party->id, 'document_date' => $w->day, 'supplier_invoice_no' => $this->doc->number], [['item_id' => $w->service->id, 'quantity' => '2', 'unit_price' => '100']], $w->user, false);
});

it('rechecks purchase view permission before replaying a cached purchase link', function (): void {
    $w = $this->w;
    $key = (string) Str::uuid7();
    $uri = 'e-documents/documents/'.$this->doc->id.'/link-purchase';
    $body = ['version' => 1, 'purchase_invoice_id' => $this->purchase->id];
    SalesKit::post($w->user, $w->company, $uri, $body, $key)->assertOk();
    Actors::revoke($w->user, $w->company);
    Actors::grant($w->user, $w->company, ['edocuments.view', 'edocuments.import']);
    SalesKit::post($w->user, $w->company, $uri, $body, $key)->assertForbidden();
});

it('rejects linking an incoming return invoice to a normal purchase invoice', function (): void {
    $w = $this->w;
    $incoming = $this->fake->incoming->toArray();
    $incoming['uuid'] = (string) Str::uuid7();
    $incoming['invoice_type'] = 'IADE';
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($incoming);
    $this->doc = app(Documents::class)->import($w->user, '<return-fixture/>');
    SalesKit::post($w->user, $w->company, 'e-documents/documents/'.$this->doc->id.'/link-purchase', ['version' => 1, 'purchase_invoice_id' => $this->purchase->id])->assertUnprocessable();
});

it('preserves an accepted provider outcome written between status read and delivery advancement', function (): void {
    $provider = app(EDocumentProvider::class);
    $receipt = $provider->send((string) Str::uuid7(), (string) Str::uuid7(), '<fixture/>');
    $interleaved = false;
    DB::listen(function ($query) use (&$interleaved, $receipt): void {
        if (! $interleaved && str_starts_with($query->sql, 'select') && str_contains($query->sql, 'edocument_sandbox_receipts')) {
            $interleaved = true;
            DB::table('edocument_sandbox_receipts')->where('id', $receipt->id)->update(['status' => 'accepted']);
        }
    });
    expect($provider->status($receipt->id)->status)->toBe('accepted')
        ->and(DB::table('edocument_sandbox_receipts')->where('id', $receipt->id)->value('status'))->toBe('accepted')
        ->and($interleaved)->toBeTrue();
});
