<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Data;

use Illuminate\Support\Str;

/**
 * One line of a PostingRequest. Amounts are decimal strings (scale <= 4); exactly one of debit or
 * credit is positive. The account is given by id or by code.
 */
final readonly class PostingLine
{
    public function __construct(
        public ?string $accountId = null,
        public ?string $accountCode = null,
        public string $debit = '0',
        public string $credit = '0',
        public ?string $currency = null,
        public ?string $fxAmount = null,
        public ?string $fxRate = null,
        public ?string $partyId = null,
        public ?string $costCenterId = null,
        public ?string $projectId = null,
        public ?string $description = null,
        public ?string $dueDate = null,
        public ?string $documentRef = null,
    ) {}

    /**
     * @param  array<string, string|null>  $extra  named constructor arguments (currency, partyId, ...)
     */
    public static function debit(string $account, string $amount, array $extra = []): self
    {
        return self::make($account, $amount, '0', $extra);
    }

    /**
     * @param  array<string, string|null>  $extra  named constructor arguments (currency, partyId, ...)
     */
    public static function credit(string $account, string $amount, array $extra = []): self
    {
        return self::make($account, '0', $amount, $extra);
    }

    /**
     * @param  array<string, string|null>  $extra
     */
    private static function make(string $account, string $debit, string $credit, array $extra): self
    {
        $isId = Str::isUuid($account);

        return new self(...[
            'accountId' => $isId ? $account : null,
            'accountCode' => $isId ? null : $account,
            'debit' => $debit,
            'credit' => $credit,
            ...$extra,
        ]);
    }
}
