<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Data;

final readonly class TreasuryInvoiceData
{
    public function __construct(public string $id, public string $companyId, public string $module, public ?string $number, public string $invoiceType, public string $status, public string $partyId, public string $partyName, public string $documentDate, public ?string $dueDate, public string $currencyCode, public string $fxRate, public string $total, public string $historicalLocal, public string $paidAmount, public string $balanceDue, public ?string $balanceLocal = null, public ?string $controlAccountId = null) {}

    public function direction(): string
    {
        return ($this->module === 'sales') === ($this->invoiceType !== 'return') ? 'receipt' : 'payment';
    }
}
