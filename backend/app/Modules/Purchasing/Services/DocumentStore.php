<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Numbering\NumberSequenceService;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseLine;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Services\Composer\Composed;
use Illuminate\Support\Facades\DB;

/**
 * Persists composed documents (header + lines) and assigns gapless numbers. Numbers come from Core's
 * NumberSequenceService inside the caller's transaction, so a rollback gives the number back.
 */
final class DocumentStore
{
    public function __construct(private readonly NumberSequenceService $numbers) {}

    /**
     * @template T of PurchaseDocument
     *
     * @param  T  $doc
     * @param  array<string, mixed>  $extraHeader
     * @param  list<array<string, mixed>>  $extraLines  type-specific columns per line, aligned with the composed lines
     * @return T
     */
    public function create(PurchaseDocument $doc, Composed $composed, array $extraHeader = [], array $extraLines = [], ?string $actor = null): PurchaseDocument
    {
        $doc->forceFill([...$composed->header, ...$extraHeader]);
        $doc->created_by = $actor;
        $doc->save();
        $this->writeLines($doc, $composed, $extraLines);

        return $doc;
    }

    /**
     * Rewrites a draft: header columns and lines; lines whose extras carry an `id` keep that row, the others are replaced.
     *
     * @template T of PurchaseDocument
     *
     * @param  T  $doc
     * @param  array<string, mixed>  $extraHeader
     * @param  list<array<string, mixed>>  $extraLines
     * @return T
     */
    public function replace(PurchaseDocument $doc, Composed $composed, array $extraHeader = [], array $extraLines = []): PurchaseDocument
    {
        $doc->forceFill([...$composed->header, ...$extraHeader]);
        $doc->bumpVersion();
        $doc->save();
        $class = $doc::lineClass();
        $keep = array_values(array_filter(array_map(static fn (array $e): mixed => $e['id'] ?? null, $extraLines), 'is_string'));
        $class::query()->where('document_id', $doc->id)->when($keep !== [], fn ($q) => $q->whereNotIn('id', $keep))->delete();

        if ($keep !== []) {
            // Move kept rows out of the way of the unique (document_id, line_no) before renumbering.
            $class::query()->where('document_id', $doc->id)->whereIn('id', $keep)->update(['line_no' => DB::raw('line_no + 100000')]);
        }

        $this->writeLines($doc, $composed, $extraLines);

        return $doc;
    }

    public function assignNumber(PurchaseDocument|PurchaseRequest|PurchaseRfq $doc, DocumentKind $kind): void
    {
        if ($doc->number !== null) {
            return;
        }

        $doc->number = $this->numbers->next($doc->company_id, $kind->value, $kind->series(), (int) $doc->document_date->format('Y'));
    }

    /**
     * @param  list<array<string, mixed>>  $extraLines
     */
    private function writeLines(PurchaseDocument $doc, Composed $composed, array $extraLines): void
    {
        $class = $doc::lineClass();

        foreach ($composed->lines as $i => $columns) {
            $extra = $extraLines[$i] ?? [];
            $id = is_string($extra['id'] ?? null) ? $extra['id'] : null;
            unset($extra['id']);
            /** @var PurchaseLine $line */
            $line = ($id === null ? null : $class::query()->where('document_id', $doc->id)->whereKey($id)->first()) ?? new $class;
            $line->forceFill([...$columns, ...$extra]);
            $line->document_id = $doc->id;
            $line->save();
        }

        $doc->unsetRelation('lines');
    }
}
