<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Data\ProviderReceipt;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Enums\DocumentStatus;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\EDocuments\Providers\SandboxProvider;
use App\Modules\EDocuments\Services\Documents;
use App\Modules\Sales\Services\InvoiceService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
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
});

it('freezes only validated numbers and preserves source accounting through sandbox submission and replay', function (): void {
    $service = app(Documents::class);
    $w = $this->w;
    $before = DB::table('journal_entries')->count();
    $d = $service->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    expect($d->number)->toBeNull();
    $d = $service->validate($w->user, $d->id, $d->version);
    expect($d->status)->toBe(DocumentStatus::Ready)->and($d->number)->toMatch('/^ARS\d{13}$/');
    $number = $d->number;
    $uuid = $d->uuid;
    $d = $service->send($w->user, $d->id, $d->version);
    expect($d->status)->toBe(DocumentStatus::Sent);
    $again = $service->send($w->user, $d->id, 1);
    expect($again->uuid)->toBe($uuid)->and($again->number)->toBe($number);
    $d = $service->poll($w->user, $d->id, $d->version);
    expect($d->status)->toBe(DocumentStatus::Delivered)->and(DB::table('edocument_sandbox_receipts')->count())->toBe(1)->and(DB::table('journal_entries')->count())->toBe($before);
});
it('rolls back failed validation numbers and fails closed when validators are unavailable', function (): void {
    $s = app(Documents::class);
    $w = $this->w;
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $this->fake->valid = false;
    $d = $s->validate($w->user, $d->id, 1);
    expect($d->status)->toBe(DocumentStatus::Invalid)->and($d->number)->toBeNull()->and(DB::table('number_sequences')->where('doc_type', 'edocument.invoice')->count())->toBe(0);
    $this->fake->valid = true;
    $this->fake->isAvailable = false;
    $d = $s->validate($w->user, $d->id, $d->version);
    expect($d->status)->toBe(DocumentStatus::Invalid)->and($d->number)->toBeNull();
    $this->fake->isAvailable = true;
    $d = $s->validate($w->user, $d->id, $d->version);
    expect($d->number)->toEndWith('000000001');
});
it('prevents source invoice reversal after a durable send claim', function (): void {
    $s = app(Documents::class);
    $w = $this->w;
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $d = $s->validate($w->user, $d->id, 1);
    $s->send($w->user, $d->id, $d->version);
    expect(fn () => app(InvoiceService::class)->reverse($w->invoice, $w->invoice->version, $w->day, 'test reversal', false, $w->user))->toThrow(EDocumentException::class);
});
it('rejects source reversal before send and prevents duplicate source conversion', function (): void {
    $s = app(Documents::class);
    $w = $this->w;
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $d = $s->validate($w->user, $d->id, 1);
    expect(fn () => $s->create($w->user, $w->invoice->id, DocumentKind::Invoice, 'TEMELFATURA', 'ABC', $w->metadata, (string) Str::uuid7()))->toThrow(EDocumentException::class);
    app(InvoiceService::class)->reverse($w->invoice, $w->invoice->version, $w->day, 'test reversal', false, $w->user);
    expect(fn () => $s->send($w->user, $d->id, $d->version))->toThrow(EDocumentException::class);
});
it('validates source permission and current actor state on every direct mutation', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    Actors::revoke($w->user, $w->company);
    expect(fn () => $s->validate($w->user, $d->id, 1))->toThrow(HttpException::class);
});

it('locally cancels an unsubmitted numbered document without releasing its retired number', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $d = $s->validate($w->user, $d->id, 1);
    $number = $d->number;
    $d = $s->cancel($w->user, $d->id, $d->version, 'Incorrect channel');
    expect($d->status)->toBe(DocumentStatus::Cancelled)->and($d->number)->toBe($number);
    $new = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $new = $s->validate($w->user, $new->id, 1);
    expect($new->number)->not->toBe($number)->toEndWith('000000002');
});
it('replays a persisted create operation even after its original draft was cancelled', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $operation = (string) Str::uuid7();
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, $operation);
    $s->cancel($w->user, $d->id, 1, 'Incorrect draft');
    $again = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, $operation);
    expect($again->id)->toBe($d->id)->and($again->status)->toBe(DocumentStatus::Cancelled)->and(Document::query()->count())->toBe(1);
});
it('keeps a stable provider key when an acknowledgement is lost after provider acceptance', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $d = $s->validate($w->user, $d->id, 1);
    $baseline = DB::transactionLevel();
    $real = app(SandboxProvider::class);
    app()->instance(EDocumentProvider::class, new class($real, $baseline) implements EDocumentProvider
    {
        private bool $once = true;

        public function __construct(private $real, private int $baseline) {}

        public function send(string $key, string $uuid, string $xml): ProviderReceipt
        {
            expect(DB::transactionLevel())->toBe($this->baseline);
            $receipt = $this->real->send($key, $uuid, $xml);
            if ($this->once) {
                $this->once = false;
                throw new RuntimeException('Lost acknowledgement');
            }

            return $receipt;
        }

        public function status(string $id): ProviderReceipt
        {
            return $this->real->status($id);
        }

        public function respond(string $uuid, string $xml, string $decision): ProviderReceipt
        {
            return $this->real->respond($uuid, $xml, $decision);
        }

        public function taxpayer(string $number): array
        {
            return $this->real->taxpayer($number);
        }
    });
    $s = app(Documents::class);
    expect(fn () => $s->send($w->user, $d->id, $d->version))->toThrow(EDocumentException::class);
    $d->refresh();
    $key = $d->provider_key;
    expect($d->status)->toBe(DocumentStatus::Failed);
    $d = $s->send($w->user, $d->id, $d->version, true);
    expect($d->provider_key)->toBe($key)->and($d->status)->toBe(DocumentStatus::Sent)->and(DB::table('edocument_sandbox_receipts')->count())->toBe(1);
});
it('persists validation unavailability without consuming a number through actual HTTP', function (): void {
    $w = $this->w;
    $this->fake->isAvailable = false;
    $d = SalesKit::post($w->user, $w->company, 'e-documents/documents', ['source_id' => $w->invoice->id, 'kind' => 'e_archive', 'profile' => 'EARSIVFATURA', 'series' => 'ARS', 'metadata' => $w->metadata])->assertCreated()->json('data');
    $response = SalesKit::post($w->user, $w->company, 'e-documents/documents/'.$d['id'].'/validate', ['version' => 1])->assertOk()->json('data');
    expect($response['status'])->toBe('invalid')->and($response['number'])->toBeNull();
});
it('checks current permissions provider mode and password policy before cached HTTP responses', function (): void {
    $w = $this->w;
    $body = ['source_id' => $w->invoice->id, 'kind' => 'e_archive', 'profile' => 'EARSIVFATURA', 'series' => 'ARS', 'metadata' => $w->metadata];
    $key = (string) Str::uuid7();
    SalesKit::post($w->user, $w->company, 'e-documents/documents', $body, $key)->assertCreated();
    config(['edocuments.driver' => 'unimplemented-live']);
    SalesKit::post($w->user, $w->company, 'e-documents/documents', $body, $key)->assertStatus(503);
    config(['edocuments.driver' => 'sandbox']);
    $w->user->forceFill(['must_change_password' => true])->save();
    SalesKit::post($w->user, $w->company, 'e-documents/documents', $body, $key)->assertStatus(403);
    $w->user->forceFill(['must_change_password' => false])->save();
    Actors::revoke($w->user, $w->company);
    SalesKit::post($w->user, $w->company, 'e-documents/documents', $body, $key)->assertStatus(403);
});
it('rejects malformed nested metadata and idempotency key reuse with a changed request', function (): void {
    $w = $this->w;
    $body = ['source_id' => $w->invoice->id, 'kind' => 'e_archive', 'profile' => 'EARSIVFATURA', 'series' => 'ARS', 'metadata' => $w->metadata];
    $key = (string) Str::uuid7();
    SalesKit::post($w->user, $w->company, 'e-documents/documents', [...$body, 'metadata' => ['supplier_address' => ['city' => ['invalid']]]])->assertStatus(422);
    SalesKit::post($w->user, $w->company, 'e-documents/documents', $body, $key)->assertCreated();
    SalesKit::post($w->user, $w->company, 'e-documents/documents', [...$body, 'series' => 'XYZ'], $key)->assertStatus(409);
});
it('rejects company crossing and raw database mutation of validated XML', function (): void {
    $w = $this->w;
    $s = app(Documents::class);
    $d = $s->create($w->user, $w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $w->metadata, (string) Str::uuid7());
    $d = $s->validate($w->user, $d->id, 1);
    $foreign = Actors::companyFor($w->user, ['edocuments.view']);
    SalesKit::as($w->user, $foreign)->getJson('/api/v1/e-documents/documents/'.$d->id)->assertNotFound();
    DB::beginTransaction();
    try {
        expect(fn () => DB::table('edocuments')->where('id', $d->id)->update(['xml' => 'tampered']))->toThrow(QueryException::class);
    } finally {
        DB::rollBack();
    }
});
