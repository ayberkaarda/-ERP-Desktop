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
     * @param  list<StockPostedLine>  $lines  per document line (original movements only)
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
        public array $lines = [],
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
            self::lines($document->id),
        );
    }

    /** @return list<StockPostedLine> */
    private static function lines(string $documentId): array
    {
        $rows = DB::table('stock_movements as m')->join('stock_document_lines as l', 'l.id', '=', 'm.document_line_id')
            ->leftJoin('stock_lots as lot', 'lot.id', '=', 'm.lot_id')->leftJoin('stock_serials as s', 's.id', '=', 'm.serial_id')
            ->where('m.document_id', $documentId)->whereNull('m.reverses_id')->groupBy('l.line_no')->orderBy('l.line_no')
            ->selectRaw("l.line_no, sum(m.quantity) AS quantity, sum(m.total_cost) AS cost, string_agg(DISTINCT lot.lot_no, ',' ORDER BY lot.lot_no) AS lots, string_agg(DISTINCT s.serial_no, ',' ORDER BY s.serial_no) AS serials")
            ->get();
        $out = [];

        foreach ($rows as $row) {
            $out[] = new StockPostedLine(
                (int) $row->line_no,
                (string) BigDecimal::of((string) $row->quantity)->toScale(6),
                (string) BigDecimal::of((string) $row->cost)->toScale(4),
                is_string($row->lots) && $row->lots !== '' ? explode(',', $row->lots) : [],
                is_string($row->serials) && $row->serials !== '' ? explode(',', $row->serials) : [],
            );
        }

        return $out;
    }
}
