<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Data;

use App\Modules\Accounting\Enums\EntryType;
use DateTimeInterface;

/**
 * A complete, balanced entry to book. With a source the request is idempotent per purpose
 * (an invoice books 'main' once; a separate 'cogs' entry has its own purpose). A key is used by
 * one booked entry only, also after a reversal: re-booking a reversed document needs a new purpose.
 */
final readonly class PostingRequest
{
    /**
     * @param  list<PostingLine>  $lines
     * @param  string|null  $periodId  only to book into the year-end adjustment period (13)
     * @param  bool  $allowSoftClosed  the caller verified the actor may book into a soft-closed period
     */
    public function __construct(
        public string $companyId,
        public DateTimeInterface $entryDate,
        public EntryType $entryType,
        public ?string $description,
        public ?string $sourceType,
        public ?string $sourceId,
        public array $lines,
        public string $purpose = 'main',
        public ?string $postedBy = null,
        public bool $allowSoftClosed = false,
        public ?string $periodId = null,
    ) {}

    public function postingKey(): ?string
    {
        if ($this->sourceType === null || $this->sourceType === '') {
            return null;
        }

        return mb_substr($this->sourceType.'|'.($this->sourceId ?? '').'|'.$this->purpose, 0, 255);
    }
}
