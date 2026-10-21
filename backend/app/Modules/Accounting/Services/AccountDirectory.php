<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Accounting\Data\AccountData;
use App\Modules\Accounting\Models\Account;
use Illuminate\Support\Str;

final class AccountDirectory implements AccountLookup
{
    public function find(string $id): ?AccountData
    {
        $account = Str::isUuid($id) ? Account::query()->find($id) : null;

        return $account === null ? null : AccountData::of($account);
    }

    public function findByCode(string $code): ?AccountData
    {
        $account = Account::query()->where('code', $code)->first();

        return $account === null ? null : AccountData::of($account);
    }
}
