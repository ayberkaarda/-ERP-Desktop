<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Assistant;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\EDocuments\Models\Document;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

final class ReadService
{
    /** @return array<string,mixed> */
    public function list(User $actor, string $direction, string $search): array
    {
        $actor = $actor->fresh() ?? abort(403);
        $authorizer = app(CompanyAuthorizer::class);
        $authorizer->forget($actor->id);
        $company = app(CompanyContext::class)->id();
        $invoice = $authorizer->allows($actor, 'sales.invoices.view', $company);
        $despatch = $authorizer->allows($actor, 'sales.deliveries.view', $company);
        $query = Document::query()->where('direction', $direction);
        if ($direction === 'outgoing') {
            $query->where(function ($q) use ($invoice, $despatch): void {
                $q->whereRaw('false');
                if ($invoice) {
                    $q->orWhereIn('kind', ['e_invoice', 'e_archive']);
                }if ($despatch) {
                    $q->orWhere('kind', 'e_despatch');
                }
            });
        }
        $term = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);
        $rows = $query->where(fn ($q) => $q->where('number', 'ilike', '%'.$term.'%')->orWhere('party_name', 'ilike', '%'.$term.'%'))->orderByDesc('id')->limit(21)->get();

        return ['sandbox' => true, 'has_more' => $rows->count() > 20, 'documents' => $rows->take(20)->map(static fn (Document $d): array => ['id' => $d->id, 'number' => $d->number, 'kind' => $d->kind->value, 'status' => $d->status->value, 'party_name' => $d->party_name, 'document_date' => $d->document_date->format('Y-m-d'), 'url' => '/edocuments/documents/'.$d->id])->values()->all()];
    }
}
