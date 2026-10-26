<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\QuoteStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property QuoteStatus $status
 * @property Carbon|null $valid_until
 * @property int $revision
 * @property string|null $previous_revision_id
 * @property string|null $converted_order_id
 * @property Carbon|null $sent_at
 * @property Carbon|null $accepted_at
 * @property Carbon|null $rejected_at
 * @property string|null $rejection_reason
 * @property-read Collection<int, SalesQuoteLine> $lines
 */
class SalesQuote extends SalesDocument
{
    protected $table = 'sales_quotes';

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'revision' => 1];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Quote;
    }

    public static function lineClass(): string
    {
        return SalesQuoteLine::class;
    }

    /** @return HasMany<SalesQuoteLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(SalesQuoteLine::class, 'document_id')->orderBy('line_no');
    }

    protected function extraCasts(): array
    {
        return [
            'status' => QuoteStatus::class, 'valid_until' => 'date', 'revision' => 'integer',
            'sent_at' => 'datetime', 'accepted_at' => 'datetime', 'rejected_at' => 'datetime',
        ];
    }
}
