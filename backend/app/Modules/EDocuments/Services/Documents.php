<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Services;

use App\Core\Company\CompanyContext;
use App\Core\Numbering\NumberSequenceService;
use App\Models\User;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Enums\DocumentStatus;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\EDocuments\Models\DocumentEvent;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Organization\Contracts\EDocumentCompany;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Sales\Contracts\EDocumentSources;
use App\Modules\Sales\Data\EDocumentSource;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

final readonly class Documents
{
    public function __construct(private EDocumentSources $sources, private EDocumentCompany $company, private DocumentXml $xml, private EDocumentProvider $provider, private Access $access) {}

    /** @param array<string,mixed> $metadata */
    public function create(User $user, string $sourceId, DocumentKind $kind, string $profile, string $series, array $metadata, string $operation): Document
    {
        $this->access->authorize($user, 'edocuments.create');
        $this->access->source($user, $kind);

        return DB::transaction(function () use ($user, $sourceId, $kind, $profile, $series, $metadata, $operation): Document {
            $replayed = Document::query()->where('operation_id', $operation)->first();
            if ($replayed !== null) {
                return $replayed;
            }
            $source = $this->sources->snapshot($kind->sourceType(), $sourceId, true);
            $this->eligible($source);
            $existing = Document::query()->where('source_type', $kind->sourceType())->where('source_id', $sourceId)->where('status', '!=', DocumentStatus::Cancelled->value)->first();
            if ($existing !== null) {
                if ($existing->getAttribute('operation_id') === $operation) {
                    return $existing;
                }throw new EDocumentException('EDOC_SOURCE_ALREADY_USED', 'An electronic document already exists for this source.');
            }
            $document = Document::query()->create(['company_id' => app(CompanyContext::class)->id(), 'created_by' => $user->id, 'operation_id' => $operation, 'direction' => 'outgoing', 'kind' => $kind, 'profile' => $profile, 'status' => DocumentStatus::Draft, 'uuid' => (string) Str::uuid7(), 'series' => $series, 'document_date' => $source->payload['issue_date'], 'currency_code' => $source->payload['currency'], 'total' => $source->payload['totals']['total'], 'party_name' => $source->payload['customer']['name'], 'source_type' => $kind->sourceType(), 'source_id' => $sourceId, 'source_number' => $source->payload['source']['number'], 'source_version' => $source->version, 'source_hash' => $source->fingerprint, 'snapshot' => $this->snapshot($source, $metadata), 'metadata' => $metadata, 'validation' => ['available' => false, 'valid' => false, 'errors' => [], 'warnings' => []], 'version' => 1]);
            $this->event($document, $user, 'created', null, DocumentStatus::Draft, 'Sandbox document draft created.');

            return $document;
        });
    }

    /** @param array<string,mixed> $metadata */
    public function update(User $user, string $id, int $version, array $metadata, ?string $profile, ?string $series): Document
    {
        return DB::transaction(function () use ($user, $id, $version, $metadata, $profile, $series): Document {
            $d = $this->locked($id, $version);
            $this->access->authorize($user, 'edocuments.create', $d);
            if (! in_array($d->status, [DocumentStatus::Draft, DocumentStatus::Invalid], true) || $d->number !== null) {
                throw new EDocumentException('EDOC_IMMUTABLE', 'Only unnumbered drafts can be edited.');
            }
            $source = $this->sources->snapshot((string) $d->source_type, (string) $d->source_id);
            $this->eligible($source);
            $nextProfile = $profile ?? $d->profile;
            if (! in_array($nextProfile, $d->kind->profiles(), true)) {
                throw ValidationException::withMessages(['profile' => 'The profile does not match the document kind.']);
            }
            $from = $d->status;
            $d->update(['metadata' => $metadata, 'profile' => $nextProfile, 'series' => $series ?? $d->series, 'snapshot' => $this->snapshot($source, $metadata), 'source_hash' => $source->fingerprint, 'source_version' => $source->version, 'status' => DocumentStatus::Draft, 'validation' => ['available' => false, 'valid' => false, 'errors' => [], 'warnings' => []], 'version' => $d->version + 1]);
            $this->event($d, $user, 'updated', $from, DocumentStatus::Draft, 'Sandbox draft metadata updated.');

            return $d;
        });
    }

    public function validate(User $user, string $id, int $version): Document
    {
        try {
            return DB::transaction(function () use ($user, $id, $version): Document {
                $initial = Document::query()->findOrFail($id);
                if ($initial->direction !== 'outgoing') {
                    throw new EDocumentException('EDOC_STATE', 'Only outgoing documents can be validated.');
                }
                $source = $this->sources->snapshot((string) $initial->source_type, (string) $initial->source_id, true);
                $d = $this->locked($id, $version);
                $this->access->authorize($user, 'edocuments.validate', $d);
                $this->eligible($source);
                if (! in_array($d->status, [DocumentStatus::Draft, DocumentStatus::Invalid, DocumentStatus::Ready], true)) {
                    throw new EDocumentException('EDOC_IMMUTABLE', 'Submitted documents cannot be changed or revalidated.');
                }
                if ($source->fingerprint !== $d->source_hash) {
                    throw new EDocumentException('EDOC_SOURCE_CHANGED', 'The source snapshot has changed. Refresh the draft before validating.');
                }
                $snapshot = $d->snapshot;
                $number = $d->number ?? app(NumberSequenceService::class)->next($d->company_id, 'edocument.'.$d->kind->sourceType(), $d->series, (int) $d->document_date->format('Y'));
                if (preg_match('/^[A-Z]{3}\d{13}$/', $number) !== 1) {
                    throw new EDocumentException('EDOC_NUMBER_EXHAUSTED', 'The document series is exhausted.', 422);
                }
                $snapshot = [...$snapshot, 'kind' => $d->kind->value, 'profile' => $d->profile, 'uuid' => $d->uuid, 'number' => $number, 'metadata' => $d->metadata];
                if ($d->profile === 'IHRACAT' && ($snapshot['invoice_type'] ?? 'SATIS') === 'SATIS' && ! empty($d->metadata['tax_exemption_code']) && BigDecimal::of((string) $snapshot['totals']['tax'])->isZero() && array_all($snapshot['lines'], static fn (array $line): bool => BigDecimal::of((string) $line['tax_rate'])->isZero())) {
                    $snapshot['invoice_type'] = 'ISTISNA';
                }
                try {
                    $xml = $this->xml->generate(XmlDocumentSnapshot::fromArray($snapshot));
                    $validation = $this->xml->validate($xml, $d->kind->value)->toArray();
                } catch (ValidationException $error) {
                    $errors = [];
                    foreach ($error->errors() as $path => $messages) {
                        foreach ($messages as $message) {
                            $errors[] = ['layer' => 'business', 'code' => 'SNAPSHOT_INVALID', 'path' => $path, 'message' => $message];
                        }
                    }
                    throw new InvalidXml(['available' => $this->xml->available(), 'valid' => false, 'errors' => array_slice($errors, 0, 100), 'warnings' => [], 'metadata' => ['xsd_executed' => false, 'schematron_executed' => false, 'signature_verified' => false]]);
                }
                if (! ($validation['available'] ?? false) || ! ($validation['valid'] ?? false)) {
                    throw new InvalidXml($validation);
                }
                $from = $d->status;
                $d->update(['number' => $number, 'xml' => $xml, 'xml_hash' => hash('sha256', $xml), 'snapshot' => $snapshot, 'validation' => $validation, 'status' => DocumentStatus::Ready, 'version' => $d->version + 1]);
                $this->event($d, $user, 'validated', $from, DocumentStatus::Ready, 'Official offline structural validation completed; sandbox document remains unsigned.');

                return $d;
            });
        } catch (InvalidXml $invalid) {
            return DB::transaction(function () use ($user, $id, $version, $invalid): Document {
                $d = $this->locked($id, $version);
                $from = $d->status;
                $d->update(['validation' => $invalid->validation, 'status' => DocumentStatus::Invalid, 'version' => $d->version + 1]);
                $this->event($d, $user, 'validation_failed', $from, DocumentStatus::Invalid, 'XML validation failed or its official runtime is unavailable.');

                return $d;
            });
        }
    }

    public function send(User $user, string $id, int $version, bool $retry = false): Document
    {
        $preview = Document::query()->findOrFail($id);
        $this->access->authorize($user, 'edocuments.send', $preview);
        if (in_array($preview->status, [DocumentStatus::Sent, DocumentStatus::Delivered, DocumentStatus::Accepted, DocumentStatus::Rejected], true)) {
            return $preview;
        }
        $directory = $preview->provider_key === null && $preview->kind !== DocumentKind::Despatch ? $this->provider->taxpayer((string) ($preview->snapshot['customer']['tax_number'] ?? '')) : null;
        $invoiceRegistered = $directory !== null && array_any($directory['aliases'], static fn (array $alias): bool => $alias['kind'] === 'e_invoice');
        $d = DB::transaction(function () use ($user, $id, $version, $retry, $invoiceRegistered): Document {
            $initial = Document::query()->findOrFail($id);
            if ($initial->direction !== 'outgoing') {
                throw new EDocumentException('EDOC_STATE', 'Incoming documents cannot be sent.');
            }
            $source = $this->sources->snapshot((string) $initial->source_type, (string) $initial->source_id, true);
            $d = Document::query()->lockForUpdate()->findOrFail($id);
            $this->access->authorize($user, 'edocuments.send', $d);
            if (in_array($d->status, [DocumentStatus::Sent, DocumentStatus::Delivered, DocumentStatus::Accepted, DocumentStatus::Rejected], true)) {
                return $d;
            }
            $this->version($d, $version);
            $this->eligible($source);
            if ($source->fingerprint !== $d->source_hash) {
                throw new EDocumentException('EDOC_SOURCE_CHANGED', 'The source has changed since its XML snapshot was validated.');
            }
            $allowed = $retry ? [DocumentStatus::Failed, DocumentStatus::Sending] : [DocumentStatus::Ready];
            if (! in_array($d->status, $allowed, true) || $d->xml === null || ! ($d->validation['valid'] ?? false) || ! ($d->validation['available'] ?? false)) {
                throw new EDocumentException('EDOC_NOT_READY', 'Only an officially validated frozen document can be submitted.');
            }
            if ($d->kind === DocumentKind::Invoice && $d->provider_key === null) {
                if (! $invoiceRegistered && $d->profile !== 'IHRACAT') {
                    throw ValidationException::withMessages(['recipient_alias' => 'The recipient is not registered in the sandbox e-invoice directory.']);
                }
            }
            $from = $d->status;
            $d->update(['provider_key' => $d->provider_key ?? (string) Str::uuid7(), 'status' => DocumentStatus::Sending, 'version' => $d->version + 1]);
            $this->event($d, $user, $retry ? 'retry_started' : 'send_started', $from, DocumentStatus::Sending, 'Sandbox submission started with a stable provider request key.');

            if ($d->kind === DocumentKind::Archive && $invoiceRegistered) {
                throw ValidationException::withMessages(['kind' => 'A sandbox e-invoice recipient must receive an e-invoice rather than an e-archive invoice.']);
            }

            return $d;
        });
        if ($d->status !== DocumentStatus::Sending) {
            return $d;
        }
        try {
            $this->access->authorize($user, 'edocuments.send', $d);
            $receipt = $this->provider->send((string) $d->provider_key, $d->uuid, (string) $d->xml);

            return DB::transaction(function () use ($d, $receipt, $user): Document {
                $current = Document::query()->lockForUpdate()->findOrFail($d->id);
                if ($current->status !== DocumentStatus::Sending) {
                    return $current;
                }
                $status = DocumentStatus::tryFrom($receipt->status) ?? throw new EDocumentException('EDOC_PROVIDER_STATUS', 'Unsupported provider status.');
                $this->providerTransition($current->status, $status);
                $current->update(['provider_id' => $receipt->id, 'status' => $status, 'version' => $current->version + 1]);
                $this->event($current, $user, 'submitted', DocumentStatus::Sending, $status, 'Sandbox provider recorded the unsigned document; no tax authority transmission occurred.');

                return $current;
            });
        } catch (Throwable $exception) {
            DB::transaction(function () use ($d, $user): void {
                $current = Document::query()->lockForUpdate()->findOrFail($d->id);
                if ($current->status === DocumentStatus::Sending) {
                    $current->update(['status' => DocumentStatus::Failed, 'version' => $current->version + 1]);
                    $this->event($current, $user, 'send_failed', DocumentStatus::Sending, DocumentStatus::Failed, 'Submission failed or its outcome is unknown. Retry with the same provider key.');
                }
            });
            if ($exception instanceof ValidationException || $exception instanceof EDocumentException) {
                throw $exception;
            }
            throw new EDocumentException('EDOC_PROVIDER_FAILED', 'The sandbox provider could not complete the request.', 503);
        }
    }

    public function poll(User $user, string $id, int $version): Document
    {
        $d = Document::query()->findOrFail($id);
        $this->access->authorize($user, 'edocuments.send', $d);
        $this->version($d, $version);
        if ($d->provider_id === null) {
            throw new EDocumentException('EDOC_STATE', 'The document has no provider receipt.');
        }
        $receipt = $this->provider->status($d->provider_id);

        return DB::transaction(function () use ($id, $version, $receipt, $user): Document {
            $d = $this->locked($id, $version);
            $status = DocumentStatus::tryFrom($receipt->status) ?? throw new EDocumentException('EDOC_PROVIDER_STATUS', 'Unknown provider status.');
            $this->providerTransition($d->status, $status);
            if ($status !== $d->status) {
                $from = $d->status;
                $d->update(['status' => $status, 'version' => $d->version + 1]);
                $this->event($d, $user, 'polled', $from, $status, 'Sandbox provider status refreshed.');
            }

            return $d;
        });
    }

    public function cancel(User $user, string $id, int $version, string $reason): Document
    {
        return DB::transaction(function () use ($user, $id, $version, $reason): Document {
            $d = $this->locked($id, $version);
            $this->access->authorize($user, 'edocuments.create', $d);
            if ($d->direction !== 'outgoing' || $d->provider_key !== null || ! in_array($d->status, [DocumentStatus::Draft, DocumentStatus::Invalid, DocumentStatus::Ready], true)) {
                throw new EDocumentException('EDOC_CANCEL_NOT_ALLOWED', 'Only an unsubmitted outgoing draft can be locally cancelled.');
            }
            $from = $d->status;
            $d->update(['status' => DocumentStatus::Cancelled, 'version' => $d->version + 1]);
            $this->event($d, $user, 'cancelled', $from, DocumentStatus::Cancelled, 'Local cancellation only: '.$reason);

            return $d;
        });
    }

    public function import(User $user, string $xml): Document
    {
        $this->access->authorize($user, 'edocuments.import');
        if (strlen($xml) > (int) config('edocuments.max_xml_bytes', 2097152)) {
            throw ValidationException::withMessages(['xml' => 'XML exceeds the size limit.']);
        }
        $snapshot = $this->xml->parse($xml)->toArray();
        $kind = DocumentKind::tryFrom((string) ($snapshot['kind'] ?? ''));
        if ($kind === null) {
            throw ValidationException::withMessages(['xml' => 'Unsupported incoming document kind.']);
        }
        Validator::make($snapshot, [
            'uuid' => ['required', 'uuid'], 'number' => ['required', 'regex:/^[A-Z]{3}\d{13}$/'], 'profile' => ['required', Rule::in($kind->profiles())],
            'issue_date' => ['required', 'date_format:Y-m-d'], 'currency' => ['required', 'regex:/^[A-Z]{3}$/'], 'totals.total' => ['required', 'string', 'regex:/^\d{1,16}(\.\d{1,4})?$/'],
            'supplier.name' => ['required', 'string', 'max:255'], 'supplier.tax_number' => ['required', 'string', 'max:30'], 'customer.tax_number' => ['required', 'string', 'max:30'],
            'lines' => ['sometimes', 'array', 'max:500'],
        ])->validate();
        $validation = $this->xml->validate($xml, $kind->value)->toArray();
        if (! ($validation['valid'] ?? false) || ! ($validation['available'] ?? false)) {
            throw new EDocumentException('EDOC_XML_INVALID', 'Incoming XML did not pass available official structural validation.', 422);
        }
        $company = $this->company->profile();
        if ((string) ($snapshot['customer']['tax_number'] ?? '') !== (string) ($company['tax_number'] ?? '') || empty($company['tax_number'])) {
            throw new EDocumentException('EDOC_RECIPIENT_MISMATCH', 'The incoming document is not addressed to this company.', 422);
        }
        $hash = hash('sha256', $xml);

        return DB::transaction(function () use ($snapshot, $kind, $validation, $hash, $xml, $user): Document {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['edoc-import:'.app(CompanyContext::class)->id().':'.$snapshot['uuid']]);
            $existing = Document::query()->where('uuid', $snapshot['uuid'])->lockForUpdate()->first();
            if ($existing !== null) {
                if ($existing->direction === 'incoming' && $existing->xml_hash === $hash) {
                    return $existing;
                }throw new EDocumentException('EDOC_UUID_CONFLICT', 'This UUID already belongs to different document content.');
            }
            $d = Document::query()->create(['company_id' => app(CompanyContext::class)->id(), 'created_by' => $user->id, 'direction' => 'incoming', 'kind' => $kind, 'profile' => $snapshot['profile'], 'status' => DocumentStatus::Delivered, 'uuid' => $snapshot['uuid'], 'number' => $snapshot['number'], 'series' => substr((string) $snapshot['number'], 0, 3), 'document_date' => $snapshot['issue_date'], 'currency_code' => $snapshot['currency'], 'total' => $snapshot['totals']['total'], 'party_name' => $snapshot['supplier']['name'], 'snapshot' => $snapshot, 'metadata' => $snapshot['metadata'] ?? [], 'validation' => $validation, 'xml' => $xml, 'xml_hash' => $hash, 'version' => 1]);
            $this->event($d, $user, 'imported', null, DocumentStatus::Delivered, 'Unsigned/unverified XML imported into the sandbox inbox. No accounting entry was created.');

            return $d;
        });
    }

    public function respond(User $user, string $id, int $version, string $decision, string $reason): Document
    {
        $d = Document::query()->findOrFail($id);
        $this->access->authorize($user, 'edocuments.respond', $d);
        $target = $decision === 'accept' ? DocumentStatus::Accepted : DocumentStatus::Rejected;

        $d = DB::transaction(function () use ($id, $version, $decision, $reason, $target): Document {
            $d = Document::query()->lockForUpdate()->findOrFail($id);
            if ($d->direction !== 'incoming' || $d->kind !== DocumentKind::Invoice || $d->profile !== 'TICARIFATURA') {
                throw new EDocumentException('EDOC_RESPONSE_NOT_ALLOWED', 'Only an incoming commercial invoice supports an application response.');
            }
            if ($d->status === $target) {
                return $d;
            }
            if ($d->status !== DocumentStatus::Delivered) {
                throw new EDocumentException('EDOC_RESPONSE_RESOLVED', 'This document already has a response.');
            }
            $claimed = $d->metadata['response_decision'] ?? null;
            if ($claimed !== null && $claimed !== $decision) {
                throw new EDocumentException('EDOC_RESPONSE_RESOLVED', 'A different application response has already been claimed.');
            }
            if ($claimed === null) {
                $this->version($d, $version);
                $d->update(['metadata' => [...$d->metadata, 'response_decision' => $decision, 'response_reason' => $reason], 'version' => $d->version + 1]);
            }

            return $d;
        });
        if ($d->status === $target) {
            return $d;
        }
        $this->access->authorize($user, 'edocuments.respond', $d);
        $receipt = $this->provider->respond($d->uuid, (string) $d->xml, $decision);

        return DB::transaction(function () use ($id, $target, $receipt, $user, $decision): Document {
            $d = Document::query()->lockForUpdate()->findOrFail($id);
            if ($d->status === $target) {
                return $d;
            }
            if ($d->status !== DocumentStatus::Delivered || ($d->metadata['response_decision'] ?? null) !== $decision) {
                throw new EDocumentException('EDOC_RESPONSE_RESOLVED', 'The response claim no longer matches.');
            }
            $d->update(['status' => $target, 'provider_id' => $receipt->id, 'version' => $d->version + 1]);
            $this->event($d, $user, 'responded', DocumentStatus::Delivered, $target, 'Sandbox application response: '.$decision.'. '.(string) ($d->metadata['response_reason'] ?? ''));

            return $d;
        });
    }

    public function outcome(User $user, string $id, int $version, DocumentStatus $target): Document
    {
        return DB::transaction(function () use ($user, $id, $version, $target): Document {
            $d = $this->locked($id, $version);
            $this->access->authorize($user, 'edocuments.manage', $d);
            if ($d->direction !== 'outgoing' || $d->provider_id === null) {
                throw new EDocumentException('EDOC_STATE', 'Only submitted sandbox documents can have a simulated outcome.');
            }
            $this->providerTransition($d->status, $target);
            DB::table('edocument_sandbox_receipts')->where('company_id', $d->company_id)->where('id', $d->provider_id)->update(['status' => $target->value, 'updated_at' => now()]);
            $from = $d->status;
            $d->update(['status' => $target, 'version' => $d->version + 1]);
            $this->event($d, $user, 'sandbox_outcome', $from, $target, 'A local sandbox provider outcome was simulated.');

            return $d;
        });
    }

    private function providerTransition(DocumentStatus $from, DocumentStatus $to): void
    {
        if ($from === $to) {
            return;
        }
        $allowed = match ($from) {
            DocumentStatus::Sending,DocumentStatus::Sent,DocumentStatus::Failed => [DocumentStatus::Sent, DocumentStatus::Delivered, DocumentStatus::Accepted, DocumentStatus::Rejected, DocumentStatus::Failed],
            DocumentStatus::Delivered => [DocumentStatus::Accepted, DocumentStatus::Rejected, DocumentStatus::Failed],
            default => [],
        };
        if (! in_array($to, $allowed, true)) {
            throw new EDocumentException('EDOC_PROVIDER_TRANSITION', 'The provider status would regress or invalidate this document lifecycle.');
        }
    }

    public function link(User $user, string $id, int $version, string $purchaseId): Document
    {
        return DB::transaction(function () use ($user, $id, $version, $purchaseId): Document {
            $d = $this->locked($id, $version);
            $this->access->authorize($user, 'edocuments.import', $d);
            $authorizer = app(CompanyAuthorizer::class);
            $authorizer->forget($user->id);
            if (! $authorizer->allows($user, 'purchasing.invoices.view', $d->company_id)) {
                abort(403);
            }
            if ($d->direction !== 'incoming' || $d->kind === DocumentKind::Despatch) {
                throw new EDocumentException('EDOC_LINK_NOT_ALLOWED', 'Only incoming invoices can be linked to purchase invoices.');
            }
            if ($d->purchase_invoice_id !== null && $d->purchase_invoice_id !== $purchaseId) {
                throw new EDocumentException('EDOC_ALREADY_LINKED', 'The document is already linked.');
            }
            $invoice = app(PurchaseInvoiceLookup::class)->findForUpdate($purchaseId);
            abort_if($invoice === null, 404);
            $expectedType = ($d->snapshot['invoice_type'] ?? 'SATIS') === 'IADE' ? 'return' : 'purchase';
            if ($invoice->invoiceType !== $expectedType) {
                throw ValidationException::withMessages(['purchase_invoice_id' => 'The purchase document type must match the incoming invoice type.']);
            }
            if (! in_array($invoice->status, ['draft', 'pending_approval', 'booked', 'partially_paid', 'paid'], true) || $invoice->currencyCode !== $d->currency_code || ! BigDecimal::of($invoice->total)->isEqualTo($d->total) || (string) $invoice->partyTaxNumber !== (string) ($d->snapshot['supplier']['tax_number'] ?? '')) {
                throw ValidationException::withMessages(['purchase_invoice_id' => 'Supplier tax identity, currency and total must match a valid purchase invoice.']);
            }
            $d->update(['purchase_invoice_id' => $purchaseId, 'version' => $d->version + 1]);
            $this->event($d, $user, 'linked', $d->status, $d->status, 'Linked to an existing purchase invoice without changing its accounting state.');

            return $d;
        });
    }

    /** @return array<string,mixed> */
    public function detail(Document $d): array
    {
        return [...$this->summary($d), 'company_id' => $d->company_id, 'source_version' => $d->source_version, 'purchase_invoice_id' => $d->purchase_invoice_id, 'snapshot' => $d->snapshot, 'metadata' => $d->metadata, 'validation' => $d->validation, 'events' => DocumentEvent::query()->where('document_id', $d->id)->orderByDesc('id')->limit(100)->get(['id', 'event', 'from_status', 'to_status', 'message', 'created_at'])->reverse()->values()->toArray()];
    }

    /** @return array<string,mixed> */
    public function summary(Document $d): array
    {
        return ['id' => $d->id, 'direction' => $d->direction, 'kind' => $d->kind->value, 'profile' => $d->profile, 'status' => $d->status->value, 'uuid' => $d->uuid, 'number' => $d->number, 'series' => $d->series, 'document_date' => $d->document_date->format('Y-m-d'), 'currency_code' => $d->currency_code, 'total' => $d->total, 'party_name' => $d->party_name, 'source_id' => $d->source_id, 'source_type' => $d->source_type, 'source_number' => $d->source_number, 'version' => $d->version, 'sandbox' => true, 'created_at' => $d->created_at->toISOString(), 'updated_at' => $d->updated_at->toISOString()];
    }

    private function locked(string $id, int $version): Document
    {
        $d = Document::query()->lockForUpdate()->findOrFail($id);
        $this->version($d, $version);

        return $d;
    }

    private function version(Document $d, int $version): void
    {
        if ($d->version !== $version) {
            throw new EDocumentException('VERSION_CONFLICT', 'The document version is no longer current.');
        }
    }

    private function eligible(EDocumentSource $source): void
    {
        if (! $source->eligible) {
            throw new EDocumentException('EDOC_SOURCE_STATE', 'The source must be issued/posted and not reversed or cancelled.');
        }
    }

    /**
     * @param  array<string,mixed>  $metadata
     * @return array<string,mixed>
     */
    private function snapshot(EDocumentSource $source, array $metadata): array
    {
        $data = $source->payload;
        $data['supplier'] = $this->company->profile();
        if (($data['supplier']['base_currency'] ?? 'TRY') !== 'TRY' && ($data['currency'] ?? 'TRY') !== 'TRY') {
            throw new EDocumentException('EDOC_FX_UNSUPPORTED', 'Foreign-currency electronic invoices currently require a TRY-based source company. No legal TRY exchange rate will be invented.', 422);
        }
        foreach (['supplier', 'customer'] as $party) {
            $address = $metadata[$party.'_address'] ?? [];
            if (is_array($address)) {
                $data[$party]['address'] = array_replace($data[$party]['address'] ?? [], $address);
            }
        }

        return $data;
    }

    private function event(Document $d, User $user, string $event, ?DocumentStatus $from, DocumentStatus $to, string $message): void
    {
        DocumentEvent::query()->create(['company_id' => $d->company_id, 'document_id' => $d->id, 'user_id' => $user->id, 'event' => $event, 'from_status' => $from?->value, 'to_status' => $to->value, 'message' => mb_substr($message, 0, 500)]);
    }
}
