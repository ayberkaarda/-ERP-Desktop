<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Providers;

use App\Core\Company\CompanyContext;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Data\ProviderReceipt;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final readonly class SandboxProvider implements EDocumentProvider
{
    public function send(string $key, string $uuid, string $xml): ProviderReceipt
    {
        $company = app(CompanyContext::class)->id();
        $hash = hash('sha256', $xml);
        DB::table('edocument_sandbox_receipts')->insertOrIgnore(['id' => (string) Str::uuid7(), 'company_id' => $company, 'provider_key' => $key, 'document_uuid' => $uuid, 'xml_hash' => $hash, 'status' => 'sent', 'created_at' => now(), 'updated_at' => now()]);
        $row = DB::table('edocument_sandbox_receipts')->where('company_id', $company)->where('provider_key', $key)->first();
        if ($row === null || $row->xml_hash !== $hash || $row->document_uuid !== $uuid) {
            throw new EDocumentException('EDOC_PROVIDER_CONFLICT', 'The provider key belongs to different document content.');
        }

        return new ProviderReceipt((string) $row->id, (string) $row->status);
    }

    public function status(string $id): ProviderReceipt
    {
        $query = DB::table('edocument_sandbox_receipts')->where('company_id', app(CompanyContext::class)->id())->where('id', $id);
        $row = $query->first();
        abort_if($row === null, 404);
        if ($row->status === 'sent') {
            (clone $query)->where('status', 'sent')->update(['status' => 'delivered', 'updated_at' => now()]);
            $row = $query->first();
            abort_if($row === null, 404);
        }

        return new ProviderReceipt((string) $row->id, (string) $row->status);
    }

    public function respond(string $uuid, string $xml, string $decision): ProviderReceipt
    {
        $receipt = $this->send($uuid, $uuid, $xml);
        DB::table('edocument_sandbox_receipts')->where('company_id', app(CompanyContext::class)->id())->where('id', $receipt->id)->update(['status' => $decision === 'accept' ? 'accepted' : 'rejected', 'updated_at' => now()]);

        return new ProviderReceipt($receipt->id, $decision === 'accept' ? 'accepted' : 'rejected');
    }

    public function taxpayer(string $taxNumber): array
    {
        $row = DB::table('edocument_sandbox_taxpayers')->where('company_id', app(CompanyContext::class)->id())->where('tax_number', $taxNumber)->first();
        /** @var list<array{alias:string,kind:string}> $aliases */
        $aliases = $row === null ? [] : json_decode((string) $row->aliases, true, flags: JSON_THROW_ON_ERROR);

        return ['tax_number' => $taxNumber, 'registered' => $row !== null, 'aliases' => $aliases, 'sandbox' => true];
    }
}
