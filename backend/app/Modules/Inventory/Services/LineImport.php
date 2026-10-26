<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Http\UploadedFile;

/**
 * CSV lines for count and opening documents (header row; comma or semicolon separated):
 *  count:   item_code, counted_quantity, location_code?, lot_no?
 *  opening: item_code, quantity, unit_cost, lot_no?, expiry_date?, serial_numbers? (separated by |), location_code?
 * A dry run only reports; otherwise valid files are applied to the draft (counts set or added,
 * opening lines appended). Any row error blocks applying.
 */
final class LineImport
{
    private const string QTY = '/^\d{1,14}(\.\d{1,6})?$/';

    public function __construct(
        private readonly ItemLookup $items,
        private readonly WarehouseDirectory $warehouses,
        private readonly StockDocuments $documents,
    ) {}

    /**
     * @return array{rows: int, valid: int, errors: list<array{row: int, field: string, message: string}>, applied: bool}
     */
    public function run(StockDocument $doc, UploadedFile $file, bool $dryRun, ?int $version): array
    {
        if (! in_array($doc->doc_type, [DocumentType::Count, DocumentType::Opening], true)) {
            Messages::fail('file', 'import_unsupported');
        }

        if (! $doc->isDraft()) {
            Messages::locked();
        }

        $rows = $this->read($file);
        $max = config('inventory.import_max_rows');
        $max = is_numeric($max) ? (int) $max : 5000;

        if (count($rows) > min($max, StockDocument::MAX_LINES)) {
            Messages::fail('file', 'import_too_large', ['max' => min($max, StockDocument::MAX_LINES)]);
        }

        $errors = [];
        $parsed = [];

        foreach ($rows as $i => $row) {
            $line = $this->parse($doc, $row, $i + 2, $errors);

            if ($line !== null) {
                $parsed[] = $line;
            }
        }

        $result = ['rows' => count($rows), 'valid' => count($parsed), 'errors' => $errors, 'applied' => false];

        if ($dryRun || $errors !== [] || $parsed === []) {
            return $result;
        }

        if ($doc->doc_type === DocumentType::Count) {
            $this->applyCounts($doc, $parsed, $version);
        } else {
            $existing = StockDocumentLine::query()->where('document_id', $doc->id)->orderBy('line_no')->get()
                ->map(static fn (StockDocumentLine $l): array => [
                    'item_id' => $l->item_id, 'unit_id' => $l->unit_id, 'quantity' => (string) $l->quantity, 'unit_cost' => $l->unit_cost?->__toString(),
                    'lot_no' => $l->lot_no, 'expiry_date' => $l->expiry_date?->format('Y-m-d'), 'serial_numbers' => $l->serial_numbers, 'location_id' => $l->location_id,
                ])->all();
            $this->documents->update($doc, ['lines' => [...$existing, ...$parsed]], $version ?? $doc->version);
        }

        return [...$result, 'applied' => true];
    }

    /**
     * @param  list<array<string, mixed>>  $parsed
     */
    private function applyCounts(StockDocument $doc, array $parsed, ?int $version): void
    {
        $lines = StockDocumentLine::query()->where('document_id', $doc->id)->get();
        $counts = [];
        $add = [];

        foreach ($parsed as $p) {
            $match = $lines->first(static fn (StockDocumentLine $l): bool => $l->item_id === $p['item_id']
                && $l->location_id === $p['location_id'] && ($l->lot_no ?? '') === ($p['lot_no'] ?? ''));

            if ($match !== null) {
                $counts[] = ['line_id' => $match->id, 'counted_quantity' => $p['counted_quantity']];
            } else {
                $add[] = $p;
            }

        }

        $this->documents->counts($doc, $version ?? $doc->version, $counts, $add);
    }

    /**
     * @param  array<string, string>  $row
     * @param  list<array{row: int, field: string, message: string}>  $errors
     * @return array<string, mixed>|null
     */
    private function parse(StockDocument $doc, array $row, int $no, array &$errors): ?array
    {
        $fail = static function (string $field, string $key, array $replace = []) use (&$errors, $no): void {
            $errors[] = ['row' => $no, 'field' => $field, 'message' => Messages::get($key, $replace)];
        };
        $before = count($errors);
        $item = ($row['item_code'] ?? '') === '' ? null : $this->items->findByCode($row['item_code']);

        if ($item === null || $item->type !== 'stock') {
            $fail('item_code', 'import_item_unknown', ['code' => $row['item_code'] ?? '']);
        }

        $location = null;

        if (($row['location_code'] ?? '') !== '') {
            $location = $this->warehouses->locationByCode($doc->warehouse_id, $row['location_code']);

            if ($location === null) {
                $fail('location_code', 'location_invalid');
            }
        }

        $qtyField = $doc->doc_type === DocumentType::Count ? 'counted_quantity' : 'quantity';
        $qty = $row[$qtyField] ?? '';

        if (preg_match(self::QTY, $qty) !== 1) {
            $fail($qtyField, 'import_quantity_invalid');
        }

        if ($doc->doc_type === DocumentType::Opening && preg_match(self::QTY, $row['unit_cost'] ?? '') !== 1) {
            $fail('unit_cost', 'unit_cost_required');
        }

        $expiry = $row['expiry_date'] ?? '';

        if ($expiry !== '' && (preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiry) !== 1 || strtotime($expiry) === false)) {
            $fail('expiry_date', 'import_date_invalid');
        }

        if (count($errors) > $before || $item === null) {
            return null;
        }

        $lot = ($row['lot_no'] ?? '') === '' ? null : mb_substr($row['lot_no'], 0, 64);

        if ($doc->doc_type === DocumentType::Count) {
            return ['item_id' => $item->id, 'location_id' => $location, 'lot_no' => $lot, 'counted_quantity' => Stock::qty($qty)];
        }

        $serials = ($row['serial_numbers'] ?? '') === '' ? [] : array_values(array_filter(array_map('trim', explode('|', $row['serial_numbers']))));

        return [
            'item_id' => $item->id, 'quantity' => Stock::qty($qty), 'unit_cost' => $row['unit_cost'], 'lot_no' => $lot,
            'expiry_date' => $expiry === '' ? null : $expiry, 'serial_numbers' => $serials, 'location_id' => $location,
        ];
    }

    /**
     * @return list<array<string, string>>
     */
    private function read(UploadedFile $file): array
    {
        $handle = fopen($file->getRealPath() ?: '', 'rb');

        if ($handle === false) {
            Messages::fail('file', 'import_unreadable');
        }

        $first = fgets($handle);
        $first = $first === false ? '' : preg_replace('/^\xEF\xBB\xBF/', '', $first) ?? '';
        $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
        $header = array_map(static fn (?string $h): string => strtolower(trim((string) $h)), str_getcsv(trim($first), $delimiter, '"', ''));

        if (! in_array('item_code', $header, true)) {
            fclose($handle);
            Messages::fail('file', 'import_header_invalid');
        }

        $rows = [];

        while (($cells = fgetcsv($handle, null, $delimiter, '"', '')) !== false) {
            if ($cells === [null]) {
                continue;
            }

            $row = [];

            foreach ($header as $i => $name) {
                $row[$name] = trim((string) ($cells[$i] ?? ''));
            }

            $rows[] = $row;
        }

        fclose($handle);

        return $rows;
    }
}
