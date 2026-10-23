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
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\EDocuments\Core\FakeXml;
use Tests\Support\EDocuments\EdocKit;

uses(DatabaseMigrations::class);
beforeEach(function (): void {
    $this->w = EdocKit::world();
    app(CompanyContext::class)->set($this->w->company);
    app()->instance(DocumentXml::class, new FakeXml);
    config(['database.connections.edoc_second' => config('database.connections.pgsql')]);
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('edoc_second');
    $this->b->statement("SET lock_timeout = '250ms'");
    $this->document = app(Documents::class)->create($this->w->user, $this->w->invoice->id, DocumentKind::Archive, 'EARSIVFATURA', 'ARS', $this->w->metadata, (string) Str::uuid7());
    $this->document = app(Documents::class)->validate($this->w->user, $this->document->id, 1);
});
afterEach(function (): void {
    DB::setDefaultConnection('pgsql');
    while ($this->a->transactionLevel() > 0) {
        $this->a->rollBack();
    }while ($this->b->transactionLevel() > 0) {
        $this->b->rollBack();
    }DB::purge('edoc_second');
});

it('commits its source claim before provider I O so another session cannot reverse during acknowledgement', function (): void {
    $w = $this->w;
    $real = app(SandboxProvider::class);
    $duringSend = function () use ($w): void {
        expect(DB::transactionLevel())->toBe(0);
        DB::setDefaultConnection('edoc_second');
        try {
            expect(Document::query()->findOrFail($this->document->id)->status)->toBe(DocumentStatus::Sending);
            expect(fn () => app(InvoiceService::class)->reverse($w->invoice, $w->invoice->version, $w->day, 'Contending reversal', false, $w->user))->toThrow(EDocumentException::class);
        } finally {
            DB::setDefaultConnection('pgsql');
        }
    };
    app()->instance(EDocumentProvider::class, new class($real, $duringSend) implements EDocumentProvider
    {
        public function __construct(private SandboxProvider $real, private Closure $duringSend) {}

        public function send(string $key, string $uuid, string $xml): ProviderReceipt
        {
            ($this->duringSend)();

            return $this->real->send($key, $uuid, $xml);
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
    $d = app(Documents::class)->send($w->user, $this->document->id, $this->document->version);
    expect($d->status)->toBe(DocumentStatus::Sent)->and($w->invoice->fresh()->status->value)->toBe('issued');
});

it('waits for the same source row and refuses send after a competing reversal commits', function (): void {
    $w = $this->w;
    $this->a->beginTransaction();
    app(InvoiceService::class)->reverse($w->invoice, $w->invoice->version, $w->day, 'Reversal wins', false, $w->user);
    DB::setDefaultConnection('edoc_second');
    try {
        try {
            app(Documents::class)->send($w->user, $this->document->id, $this->document->version);
            throw new RuntimeException('Expected source lock contention');
        } catch (QueryException $e) {
            expect($e->errorInfo[0])->toBe('55P03');
        }
    } finally {
        DB::setDefaultConnection('pgsql');
    }
    $this->a->commit();
    DB::setDefaultConnection('edoc_second');
    try {
        expect(fn () => app(Documents::class)->send($w->user, $this->document->id, $this->document->version))->toThrow(EDocumentException::class);
        expect(DB::table('edocument_sandbox_receipts')->count())->toBe(0);
    } finally {
        DB::setDefaultConnection('pgsql');
    }
});
