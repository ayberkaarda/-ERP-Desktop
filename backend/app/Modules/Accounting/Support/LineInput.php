<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use App\Modules\Accounting\Models\Account;
use Brick\Math\BigDecimal;

/**
 * A validated journal line before it is written.
 */
final readonly class LineInput
{
    public function __construct(
        public Account $account,
        public BigDecimal $debit,
        public BigDecimal $credit,
        public ?string $currency = null,
        public ?BigDecimal $fxAmount = null,
        public ?BigDecimal $fxRate = null,
        public ?string $partyId = null,
        public ?string $costCenterId = null,
        public ?string $projectId = null,
        public ?string $description = null,
        public ?string $dueDate = null,
        public ?string $documentRef = null,
    ) {}

    /** The same line on the other side (reversals and closing entries). */
    public function mirrored(): self
    {
        return new self(
            $this->account, $this->credit, $this->debit, $this->currency, $this->fxAmount, $this->fxRate,
            $this->partyId, $this->costCenterId, $this->projectId, $this->description, $this->dueDate, $this->documentRef,
        );
    }

    /**
     * Row for journal_lines.
     *
     * @return array<string, string|int|null>
     */
    public function row(string $companyId, string $entryId, int $lineNo, string $id): array
    {
        return [
            'id' => $id,
            'company_id' => $companyId,
            'entry_id' => $entryId,
            'line_no' => $lineNo,
            'account_id' => $this->account->id,
            'debit' => (string) $this->debit,
            'credit' => (string) $this->credit,
            'currency_code' => $this->currency,
            'fx_amount' => $this->fxAmount === null ? null : (string) $this->fxAmount,
            'fx_rate' => $this->fxRate === null ? null : (string) $this->fxRate,
            'party_id' => $this->partyId,
            'cost_center_id' => $this->costCenterId,
            'project_id' => $this->projectId,
            'description' => $this->description,
            'due_date' => $this->dueDate,
            'document_ref' => $this->documentRef,
        ];
    }
}
