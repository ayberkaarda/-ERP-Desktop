<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Inventory\Enums\DocumentStatus;
use App\Modules\Inventory\Enums\DocumentType;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Stock document (receipt, issue, transfer, count, adjustment, opening). Drafts are free to
 * change; posting writes the movements and assigns the number; a posted document is corrected
 * only by reversal, which marks it cancelled (database triggers keep it immutable otherwise).
 *
 * @property DocumentType $doc_type
 * @property string|null $number
 * @property DocumentStatus $status
 * @property Carbon $document_date
 * @property string $warehouse_id
 * @property string|null $target_warehouse_id
 * @property string|null $reason
 * @property string|null $notes
 * @property string|null $offset_event
 * @property bool $allow_expired
 * @property string|null $source_type
 * @property string|null $source_id
 * @property string|null $purpose
 * @property string|null $journal_entry_id
 * @property Carbon|null $frozen_at
 * @property Carbon|null $posted_at
 * @property string|null $posted_by
 * @property Carbon|null $reversal_date
 * @property string|null $reversal_reason
 * @property string|null $reversal_journal_entry_id
 * @property Carbon|null $reversed_at
 * @property string|null $reversed_by
 * @property string|null $created_by
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, StockDocumentLine> $lines
 */
class StockDocument extends InventoryModel
{
    use HasVersion;

    public const int MAX_LINES = 500;

    public const string MORPH = 'stock_document';

    public const array FIELDS = ['doc_type', 'number', 'status', 'document_date', 'warehouse_id', 'target_warehouse_id', 'reason', 'notes', 'offset_event', 'journal_entry_id', 'reversal_reason', 'reversal_journal_entry_id'];

    /** @var list<string> */
    protected $fillable = ['doc_type', 'document_date', 'warehouse_id', 'target_warehouse_id', 'reason', 'notes', 'offset_event', 'allow_expired'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'allow_expired' => false];

    public function getMorphClass(): string
    {
        return self::MORPH;
    }

    public function isDraft(): bool
    {
        return $this->status === DocumentStatus::Draft;
    }

    /** @return HasMany<StockDocumentLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(StockDocumentLine::class, 'document_id')->orderBy('line_no');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'doc_type' => DocumentType::class,
            'status' => DocumentStatus::class,
            'document_date' => 'date',
            'allow_expired' => 'boolean',
            'frozen_at' => 'datetime',
            'posted_at' => 'datetime',
            'reversal_date' => 'date',
            'reversed_at' => 'datetime',
        ];
    }
}
