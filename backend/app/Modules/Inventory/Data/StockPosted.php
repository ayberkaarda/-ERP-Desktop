<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

use App\Modules\Inventory\Models\StockDocument;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use stdClass;

final readonly class StockPosted
{
    /**
     * @param  list<string>  $movementIds
     */
    public function __construct(
        public string $documentId,
        public string $documentType,
        public string $number,
        public string $status,
        public ?string $journalEntryId,
        public array $movementIds,
        /** Sum of the movement costs (inbound and outbound), scale 4. */
        public string $totalCost,
        /** True when an earlier posting with the same key was returned. */
        public bool $replayed = false,
    ) {}

    public static function of(StockDocument $document, bool $replayed = false): self
    {
        $rows = DB::table('stock_movements')->where('document_id', $document->id)->whereNull('reverses_id')
            ->orderBy('seq')->get(['id', 'total_cost']);
        $total = BigDecimal::zero()->toScale(4);

        foreach ($rows as $row) {
            $total = $total->plus((string) $row->total_cost);
        }

        return new self(
            $document->id,
            $document->doc_type->value,
            (string) $document->number,
            $document->status->value,
            $document->journal_entry_id,
            array_values($rows->map(static fn (stdClass $r): string => (string) $r->id)->all()),
            (string) $total,
            $replayed,
        );
    }
}
