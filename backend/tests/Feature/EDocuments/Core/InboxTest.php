<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\EDocuments\Contracts\AssistantTools;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Enums\DocumentStatus;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\EDocuments\Services\Documents;
use App\Modules\Purchasing\Services\InvoiceService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Tests\Feature\EDocuments\Core\FakeXml;
use Tests\Support\Actors;
use Tests\Support\EDocuments\EdocKit;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);
beforeEach(function (): void {
    $this->w = EdocKit::world();
    $this->fake = new FakeXml;
    app()->instance(DocumentXml::class, $this->fake);
    app(CompanyContext::class)->set($this->w->company);
    $this->incoming = ['kind' => 'e_invoice', 'profile' => 'TICARIFATURA', 'uuid' => (string) Str::uuid7(), 'number' => 'INC'.gmdate('Y').'000000001', 'issue_date' => $this->w->day, 'currency' => 'TRY', 'supplier' => ['name' => 'Örnek Satıcı', 'tax_number' => '9876543210'], 'customer' => ['name' => 'Keystone Demo', 'tax_number' => '1234567890'], 'totals' => ['total' => '240.00'], 'lines' => [], 'metadata' => []];
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($this->incoming);
});

it('deduplicates exact incoming bytes but rejects UUID reuse with different content', function (): void {
    $s = app(Documents::class);
    $a = $s->import($this->w->user, '<fixture id="a"/>');
    $b = $s->import($this->w->user, '<fixture id="a"/>');
    expect($a->id)->toBe($b->id)->and(Document::query()->count())->toBe(1);
    expect(fn () => $s->import($this->w->user, '<fixture id="changed"/>'))->toThrow(EDocumentException::class);
});
it('allows the same invoice number from different suppliers while retaining distinct UUIDs', function (): void {
    $s = app(Documents::class);
    $a = $s->import($this->w->user, '<fixture id="a"/>');
    $this->incoming['uuid'] = (string) Str::uuid7();
    $this->incoming['supplier'] = ['name' => 'Other supplier', 'tax_number' => '1111111111'];
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($this->incoming);
    $b = $s->import($this->w->user, '<fixture id="b"/>');
    expect($a->number)->toBe($b->number)->and($a->uuid)->not->toBe($b->uuid)->and(Document::query()->count())->toBe(2);
});
it('rejects another receiver and an unavailable official validation runtime', function (): void {
    $s = app(Documents::class);
    $this->incoming['customer']['tax_number'] = '1111111111';
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($this->incoming);
    expect(fn () => $s->import($this->w->user, '<fixture/>'))->toThrow(EDocumentException::class);
    $this->incoming['customer']['tax_number'] = '1234567890';
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($this->incoming);
    $this->fake->isAvailable = false;
    expect(fn () => $s->import($this->w->user, '<fixture/>'))->toThrow(EDocumentException::class)->and(Document::query()->count())->toBe(0);
});
it('records commercial responses once and rejects conflicting or noncommercial decisions', function (): void {
    $s = app(Documents::class);
    $w = $this->w;
    $d = $s->import($w->user, '<fixture/>');
    $d = $s->respond($w->user, $d->id, 1, 'accept', '');
    expect($d->status)->toBe(DocumentStatus::Accepted);
    expect($s->respond($w->user, $d->id, 1, 'accept', '')->id)->toBe($d->id);
    expect(fn () => $s->respond($w->user, $d->id, $d->version, 'reject', 'Incorrect'))->toThrow(EDocumentException::class);
    $this->incoming['uuid'] = (string) Str::uuid7();
    $this->incoming['profile'] = 'TEMELFATURA';
    $this->fake->incoming = XmlDocumentSnapshot::fromArray($this->incoming);
    $basic = $s->import($w->user, '<basic/>');
    expect(fn () => $s->respond($w->user, $basic->id, 1, 'accept', ''))->toThrow(EDocumentException::class);
});
it('links an existing compatible purchase invoice without posting it or duplicating payables', function (): void {
    $w = $this->w;
    $w->party->roles = ['customer', 'supplier'];
    $w->party->save();
    $s = app(Documents::class);
    $d = $s->import($w->user, '<fixture/>');
    $before = DB::table('journal_entries')->count();
    $invoice = app(InvoiceService::class)->create(['party_id' => $w->party->id, 'document_date' => $w->day, 'supplier_invoice_no' => $d->number], [['item_id' => $w->service->id, 'quantity' => '2', 'unit_price' => '100']], $w->user, false);
    $d = $s->link($w->user, $d->id, 1, $invoice->id);
    expect($d->purchase_invoice_id)->toBe($invoice->id)->and($invoice->fresh()->status->value)->toBe('draft')->and(DB::table('journal_entries')->count())->toBe($before);
});
it('stages and imports local sandbox inbox items through authenticated HTTP without provider I O', function (): void {
    $w = $this->w;
    SalesKit::post($w->user, $w->company, 'e-documents/sandbox/inbox', ['xml' => '<fixture/>'])->assertCreated();
    $result = SalesKit::post($w->user, $w->company, 'e-documents/inbox/poll')->assertOk()->json('data');
    expect($result['imported'])->toBe(1)->and($result['errors'])->toBe([]);
    SalesKit::post($w->user, $w->company, 'e-documents/inbox/poll')->assertOk()->assertJsonPath('data.imported', 0);
});
it('shares an outgoing invoice number family across e-invoice and e-archive channels', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $first = $s->create($w->user, $w->invoice->id, DocumentKind::Invoice, 'TEMELFATURA', 'ABC', $w->metadata, (string) Str::uuid7());
    $first = $s->validate($w->user, $first->id, 1);
    $invoiceService = app(App\Modules\Sales\Services\InvoiceService::class);
    $invoice = $invoiceService->create(['party_id' => $w->party->id, 'document_date' => $w->day], [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100']], $w->user, false);
    [$invoice] = $invoiceService->issue($invoice, $invoice->version, null, false, $w->user);
    $next = $s->create($w->user, $invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ABC', $w->metadata, (string) Str::uuid7());
    $next = $s->validate($w->user, $next->id, 1);
    expect($first->number)->toEndWith('000000001')->and($next->number)->toEndWith('000000002');
});
it('exposes only a bounded readonly assistant tool with source visibility rechecked', function (): void {
    config(['assistant.enabled' => true]);
    $w = $this->w;
    $s = app(Documents::class);
    $document = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $tool = app(AssistantTools::class)->tools($w->user)[0];
    expect($tool->name())->toBe('e_document_status')->and($tool->kind())->toBe('read')->and($tool->allowed())->toBeTrue();
    $result = json_decode($tool->handle(new Request(['direction' => 'outgoing', 'query' => ''])), true, flags: JSON_THROW_ON_ERROR);
    expect($result['untrusted_data']['documents'])->toHaveCount(1)
        ->and($result['untrusted_data']['documents'][0]['url'])->toBe('/edocuments/documents/'.$document->id);
    Actors::revoke($w->user, $w->company);
    expect(fn () => $tool->handle(new Request(['direction' => 'outgoing', 'query' => ''])))->toThrow(AuthorizationException::class);
});
