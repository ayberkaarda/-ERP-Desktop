<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Models\User;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Enums\DocumentStatus;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\EDocuments\Services\Documents;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Sales\Contracts\EDocumentSources;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

final readonly class DocumentController
{
    public function __construct(private Documents $documents, private EDocumentProvider $provider, private DocumentXml $xml) {}

    public function status(): JsonResponse
    {
        return ApiResponse::success(['driver' => config('edocuments.driver'), 'mode' => 'sandbox', 'available' => config('edocuments.driver') === 'sandbox', 'validation_available' => $this->xml->available(), 'live_enabled' => false]);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['direction' => ['sometimes', 'in:incoming,outgoing'], 'kind' => ['sometimes', Rule::enum(DocumentKind::class)], 'status' => ['sometimes', Rule::enum(DocumentStatus::class)], 'search' => ['sometimes', 'string', 'max:100'], 'page' => ['sometimes', 'integer', 'min:1']]);
        $query = Document::query();
        foreach (['direction', 'kind', 'status'] as $field) {
            if (isset($data[$field])) {
                $query->where($field, $data[$field]);
            }
        }
        if (isset($data['search'])) {
            $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $data['search']);
            $query->where(fn ($q) => $q->where('number', 'ilike', '%'.$term.'%')->orWhere('party_name', 'ilike', '%'.$term.'%'));
        }
        $user = $this->user($request);
        $authorizer = app(CompanyAuthorizer::class);
        $authorizer->forget($user->id);
        $invoice = $authorizer->allows($user, 'sales.invoices.view', app(CompanyContext::class)->id());
        $delivery = $authorizer->allows($user, 'sales.deliveries.view', app(CompanyContext::class)->id());
        $query->where(function ($q) use ($invoice, $delivery): void {
            $q->where('direction', 'incoming');
            if ($invoice) {
                $q->orWhere(fn ($sub) => $sub->where('direction', 'outgoing')->whereIn('kind', ['e_invoice', 'e_archive']));
            }if ($delivery) {
                $q->orWhere(fn ($sub) => $sub->where('direction', 'outgoing')->where('kind', 'e_despatch'));
            }
        });
        $rows = $query->orderByDesc('id')->paginate(20);

        return ApiResponse::success($rows->getCollection()->map(fn (Document $d): array => $this->documents->summary($d))->all(), $this->pagination($rows->currentPage(), $rows->lastPage(), $rows->total()));
    }

    public function sources(Request $request): JsonResponse
    {
        $data = $request->validate(['kind' => ['required', Rule::enum(DocumentKind::class)], 'search' => ['sometimes', 'string', 'max:100'], 'page' => ['sometimes', 'integer', 'min:1']]);
        $page = (int) ($data['page'] ?? 1);
        $result = app(EDocumentSources::class)->candidates(DocumentKind::from((string) $data['kind'])->sourceType(), (string) ($data['search'] ?? ''), $page);

        return ApiResponse::success($result['records'], $this->pagination($page, max(1, (int) ceil($result['total'] / 20)), $result['total']));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['source_id' => ['required', 'uuid'], 'kind' => ['required', Rule::enum(DocumentKind::class)], 'profile' => ['required', 'string', 'max:30'], 'series' => ['required', 'regex:/^[A-Z]{3}$/'], 'metadata' => ['sometimes', 'array']]);
        $kind = DocumentKind::from((string) $data['kind']);
        if (! in_array($data['profile'], $kind->profiles(), true)) {
            throw ValidationException::withMessages(['profile' => 'Unsupported profile for this document kind.']);
        }
        $metadata = $this->metadata($data['metadata'] ?? []);
        $d = $this->documents->create($this->user($request), (string) $data['source_id'], $kind, (string) $data['profile'], (string) $data['series'], $metadata, (string) $request->attributes->get('edoc_operation_id'));

        return ApiResponse::created($this->documents->detail($d));
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::success($this->documents->detail(Document::query()->findOrFail($id)));
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $d = $request->validate(['version' => ['required', 'integer', 'min:1'], 'metadata' => ['required', 'array'], 'profile' => ['sometimes', 'string', 'max:30'], 'series' => ['sometimes', 'regex:/^[A-Z]{3}$/']]);

        return ApiResponse::success($this->documents->detail($this->documents->update($this->user($request), $id, (int) $d['version'], $this->metadata($d['metadata']), isset($d['profile']) ? (string) $d['profile'] : null, isset($d['series']) ? (string) $d['series'] : null)));
    }

    public function validateDocument(Request $request, string $id): JsonResponse
    {
        return ApiResponse::success($this->documents->detail($this->documents->validate($this->user($request), $id, $this->version($request))));
    }

    public function send(Request $request, string $id): JsonResponse
    {
        return ApiResponse::success($this->documents->detail($this->documents->send($this->user($request), $id, $this->version($request))));
    }

    public function retry(Request $request, string $id): JsonResponse
    {
        return ApiResponse::success($this->documents->detail($this->documents->send($this->user($request), $id, $this->version($request), true)));
    }

    public function poll(Request $request, string $id): JsonResponse
    {
        return ApiResponse::success($this->documents->detail($this->documents->poll($this->user($request), $id, $this->version($request))));
    }

    public function download(string $id): Response
    {
        $d = Document::query()->findOrFail($id);
        if ($d->xml === null) {
            throw new EDocumentException('EDOC_XML_UNAVAILABLE', 'Validate this document before downloading XML.');
        }

        return response($d->xml, 200, ['Content-Type' => 'application/xml; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="'.$d->uuid.'.xml"', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function import(Request $request): JsonResponse
    {
        $d = $request->validate(['xml' => ['required', 'string', 'max:2097152']]);

        return ApiResponse::created($this->documents->detail($this->documents->import($this->user($request), (string) $d['xml'])));
    }

    public function respond(Request $request, string $id): JsonResponse
    {
        $d = $request->validate(['version' => ['required', 'integer', 'min:1'], 'decision' => ['required', 'in:accept,reject'], 'reason' => ['required_if:decision,reject', 'nullable', 'string', 'max:300']]);

        return ApiResponse::success($this->documents->detail($this->documents->respond($this->user($request), $id, (int) $d['version'], (string) $d['decision'], (string) ($d['reason'] ?? ''))));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $d = $request->validate(['version' => ['required', 'integer', 'min:1'], 'reason' => ['required', 'string', 'min:3', 'max:300']]);

        return ApiResponse::success($this->documents->detail($this->documents->cancel($this->user($request), $id, (int) $d['version'], (string) $d['reason'])));
    }

    public function linkPurchase(Request $request, string $id): JsonResponse
    {
        $d = $request->validate(['version' => ['required', 'integer', 'min:1'], 'purchase_invoice_id' => ['required', 'uuid']]);

        return ApiResponse::success($this->documents->detail($this->documents->link($this->user($request), $id, (int) $d['version'], (string) $d['purchase_invoice_id'])));
    }

    public function taxpayers(Request $request): JsonResponse
    {
        $d = $request->validate(['tax_number' => ['required', 'regex:/^\d{10,11}$/']]);

        return ApiResponse::success($this->provider->taxpayer((string) $d['tax_number']));
    }

    public function saveTaxpayer(Request $request): JsonResponse
    {
        $d = $request->validate(['tax_number' => ['required', 'regex:/^\d{10,11}$/'], 'name' => ['required', 'string', 'max:255'], 'aliases' => ['required', 'array', 'min:1', 'max:10'], 'aliases.*' => ['array:alias,kind'], 'aliases.*.alias' => ['required', 'string', 'max:255', 'regex:/^urn:mail:[A-Za-z0-9._@+\-]+$/'], 'aliases.*.kind' => ['required', 'in:e_invoice,e_despatch']]);
        DB::table('edocument_sandbox_taxpayers')->updateOrInsert(['company_id' => app(CompanyContext::class)->id(), 'tax_number' => $d['tax_number']], ['id' => (string) Str::uuid7(), 'name' => $d['name'], 'aliases' => json_encode($d['aliases'], JSON_THROW_ON_ERROR), 'created_at' => now(), 'updated_at' => now()]);

        return ApiResponse::success($this->provider->taxpayer((string) $d['tax_number']));
    }

    public function stageInbox(Request $request): JsonResponse
    {
        $d = $request->validate(['xml' => ['required', 'string', 'max:2097152']]);
        $xml = (string) $d['xml'];
        $this->xml->parse($xml);
        $company = app(CompanyContext::class)->id();
        $hash = hash('sha256', $xml);
        DB::table('edocument_sandbox_inbox')->insertOrIgnore(['id' => (string) Str::uuid7(), 'company_id' => $company, 'xml' => $xml, 'xml_hash' => $hash, 'state' => 'pending', 'created_at' => now(), 'updated_at' => now()]);

        return ApiResponse::created(['id' => DB::table('edocument_sandbox_inbox')->where('company_id', $company)->where('xml_hash', $hash)->value('id')]);
    }

    public function pollInbox(Request $request): JsonResponse
    {
        $company = app(CompanyContext::class)->id();
        $rows = DB::table('edocument_sandbox_inbox')->where('company_id', $company)->where('state', 'pending')->orderBy('id')->limit(20)->get();
        $documents = [];
        $errors = [];
        foreach ($rows as $row) {
            try {
                $document = $this->documents->import($this->user($request), (string) $row->xml);
                DB::table('edocument_sandbox_inbox')->where('id', $row->id)->where('company_id', $company)->update(['state' => 'imported', 'document_id' => $document->id, 'updated_at' => now()]);
                $documents[] = $this->documents->summary($document);
            } catch (\Throwable) {
                DB::table('edocument_sandbox_inbox')->where('id', $row->id)->where('company_id', $company)->update(['state' => 'invalid', 'error' => 'The sandbox item could not be imported.', 'updated_at' => now()]);
                $errors[] = ['id' => (string) $row->id, 'message' => 'The sandbox item failed validation or recipient matching.'];
            }
        }

        return ApiResponse::success(['imported' => count($documents), 'documents' => $documents, 'errors' => $errors]);
    }

    public function setOutcome(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['version' => ['required', 'integer', 'min:1'], 'outcome' => ['required', 'in:delivered,accepted,rejected,failed']]);

        return ApiResponse::success($this->documents->detail($this->documents->outcome($this->user($request), $id, (int) $data['version'], DocumentStatus::from((string) $data['outcome']))));
    }

    private function user(Request $request): User
    {
        $u = $request->user();
        abort_unless($u instanceof User, 401);

        return $u;
    }

    private function version(Request $request): int
    {
        $d = $request->validate(['version' => ['required', 'integer', 'min:1']]);

        return (int) $d['version'];
    }

    /**
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function metadata(array $data): array
    {
        if (strlen(json_encode($data, JSON_THROW_ON_ERROR)) > 65536) {
            throw ValidationException::withMessages(['metadata' => 'Metadata exceeds its size limit.']);
        }

        $allowed = ['supplier_address', 'customer_address', 'delivery_address', 'export_delivery_address', 'unit_codes', 'tax_exemption_code', 'tax_exemption_reason', 'issue_time', 'payment_iban', 'export_delivery_terms', 'export_transport_mode', 'export_gtip', 'export_gtip_codes', 'export_package_type', 'export_package_quantity', 'export_package_id', 'actual_despatch_date', 'actual_despatch_time', 'driver_first_name', 'driver_last_name', 'driver_tax_number', 'vehicle_plate', 'recipient_alias', 'original_invoice_number', 'original_invoice_date'];
        $rules = ['metadata' => ['array:'.implode(',', $allowed)]];
        foreach (['supplier_address', 'customer_address', 'delivery_address', 'export_delivery_address'] as $key) {
            $rules['metadata.'.$key] = ['sometimes', 'array:street,city,district,postal_code,country_code'];
            foreach (['street', 'city', 'district', 'postal_code', 'country_code'] as $field) {
                $rules['metadata.'.$key.'.'.$field] = ['sometimes', 'string', 'max:500'];
            }
        }
        foreach (array_diff($allowed, ['supplier_address', 'customer_address', 'delivery_address', 'export_delivery_address', 'unit_codes', 'export_gtip_codes']) as $key) {
            $rules['metadata.'.$key] = ['sometimes', 'string', 'max:1000'];
        }
        foreach (['unit_codes', 'export_gtip_codes'] as $key) {
            $rules['metadata.'.$key] = ['sometimes', 'array', 'max:500'];
            $rules['metadata.'.$key.'.*'] = ['string', 'max:20'];
        }
        $validated = Validator::make(['metadata' => $data], $rules)->validate();

        return $validated['metadata'];
    }

    /** @return array{pagination:array{current_page:int,last_page:int,total:int,per_page:int}} */
    private function pagination(int $page, int $last, int $total): array
    {
        return ['pagination' => ['current_page' => $page, 'last_page' => $last, 'total' => $total, 'per_page' => 20]];
    }
}
