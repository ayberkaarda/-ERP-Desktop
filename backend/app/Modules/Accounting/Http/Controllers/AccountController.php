<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Accounting\Http\Requests\AccountRequest;
use App\Modules\Accounting\Http\Requests\ImportAccountsRequest;
use App\Modules\Accounting\Http\Resources\AccountResource;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Services\AccountImporter;
use App\Modules\Accounting\Services\BalanceBook;
use App\Modules\Accounting\Services\ChartOfAccounts;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * Flat list filters: type, postable (is_postable), active (is_active), tdhp_group, level, currency_code,
 * parent_id (uuid or "root"); q on code/name. GET /accounts/tree returns the whole chart nested.
 */
final class AccountController extends AccountingController
{
    public function __construct(
        private readonly ChartOfAccounts $chart,
        private readonly BalanceBook $balances,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Account::class);
        [$request, $custom] = $this->customFilters($request, ['parent_id']);
        $query = Account::query();

        if (($custom['parent_id'] ?? null) === 'root') {
            $query->whereNull('parent_id');
        } elseif (isset($custom['parent_id'])) {
            $query->where('parent_id', $this->uuid('filter.parent_id', $custom['parent_id']));
        }

        if ($request->query('sort') === null) {
            $query->orderBy('code');
        }

        return ApiResponse::paginated(
            ListQuery::for(
                $query,
                $request,
                ['code', 'name', 'level', 'created_at'],
                ['type' => 'type', 'postable' => 'is_postable', 'is_postable' => 'is_postable', 'active' => 'is_active', 'is_active' => 'is_active', 'tdhp_group' => 'tdhp_group', 'level' => 'level', 'currency_code' => 'currency_code'],
                ['code', 'name'],
            ),
            AccountResource::class,
        );
    }

    public function tree(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Account::class);
        $accounts = Account::query()->orderBy('code')->get();
        $children = [];

        foreach ($accounts as $account) {
            $children[$account->parent_id ?? ''][] = $account;
        }

        $build = static function (string $parent) use (&$build, $children): array {
            return array_map(static fn (Account $a): array => [
                ...AccountResource::fields($a),
                'children' => $build($a->id),
            ], $children[$parent] ?? []);
        };

        return ApiResponse::success($build(''));
    }

    public function store(AccountRequest $request): JsonResponse
    {
        return ApiResponse::created($this->resolve(new AccountResource($this->chart->create($request->validated())), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', Account::class);
        $account = Account::query()->findOrFail($id);
        Gate::authorize('view', $account);

        return ApiResponse::success($this->resolve(new AccountResource($account), $request));
    }

    public function update(AccountRequest $request, string $id): JsonResponse
    {
        $account = Account::query()->findOrFail($id);
        Gate::authorize('update', $account);
        $account = $this->chart->update($account, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new AccountResource($account), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', Account::class);
        $account = Account::query()->findOrFail($id);
        Gate::authorize('delete', $account);
        $this->chart->delete($account, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }

    public function import(ImportAccountsRequest $request, AccountImporter $importer): JsonResponse
    {
        $file = $request->file('file');

        if (! $file instanceof UploadedFile) {
            abort(422);
        }

        return ApiResponse::success($importer->import($file, $request->boolean('dry_run')));
    }

    /**
     * Booked totals up to and including as_of (default: all), plus the foreign balance of a currency account.
     */
    public function balance(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', Account::class);
        $account = Account::query()->findOrFail($id);
        Gate::authorize('view', $account);
        $asOf = $request->query('as_of');
        $date = is_string($asOf) && $asOf !== '' ? new DateTimeImmutable($this->date('as_of', $asOf)) : null;
        $totals = $this->balances->accountAsOf($account->id, $date, $account->currency_code);

        return ApiResponse::success([
            'account_id' => $account->id,
            'as_of' => $date?->format('Y-m-d'),
            'debit' => (string) $totals['debit'],
            'credit' => (string) $totals['credit'],
            'balance' => (string) $totals['balance'],
            'balance_side' => $totals['balance']->isNegative() ? 'credit' : ($totals['balance']->isZero() ? null : 'debit'),
            'currency_code' => $account->currency_code,
            'fx_balance' => $totals['fx_balance']?->__toString(),
        ]);
    }
}
