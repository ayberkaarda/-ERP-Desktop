<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Assistant;

use App\Modules\Treasury\Models\TreasuryAccount;
use App\Modules\Treasury\Services\AccountService;

final class ReadService
{
    /** @return array<string, mixed> */
    public function balances(string $asOf, int $page): array
    {
        $data = ['as_of' => $asOf, 'page' => $page];
        $rows = TreasuryAccount::query()->where('is_active', true)->orderBy('code')->offset(((int) $data['page'] - 1) * 20)->limit(21)->get();

        return ['as_of' => $data['as_of'], 'page' => (int) $data['page'], 'has_more' => $rows->count() > 20, 'accounts' => $rows->take(20)->map(static fn (TreasuryAccount $account): array => ['id' => (string) $account->getKey(), 'code' => $account->getAttribute('code'), 'name' => $account->getAttribute('name'), 'currency_code' => $account->getAttribute('currency_code'), 'balance' => app(AccountService::class)->balance((string) $account->getKey(), (string) $data['as_of'])])->values()->all()];
    }
}
