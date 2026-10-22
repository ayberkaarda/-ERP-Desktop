<?php

declare(strict_types=1);

use App\Modules\Purchasing\Reports\Http\Requests\PurchaseReportRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->w->user = PurchKit::user(['purchasing.reports.view']);
    $this->get = fn (string $uri, mixed $user = null) => PurchKit::get($user ?? $this->w->user, $this->w->company, 'purchase-reports/'.$uri);
});

it('answers 403 before validation without the report permission on every route', function (string $report, bool $export): void {
    // Every other purchasing permission, not the report one.
    $user = PurchKit::user();
    $uri = $report.($export ? '/export' : '').'?as_of=nope&date_from=x&group_by=nope&format=pdf&per_page=0';

    ($this->get)($uri, $user)->assertForbidden();
})->with(fn (): array => array_merge(...array_map(
    fn (string $r): array => [$r => [$r, false], $r.' export' => [$r, true]],
    PurchaseReportRequest::reports(),
)));

it('grants the report permission to the purchasing, accountant and viewer roles by default', function (): void {
    $catalog = require app_path('Modules/Purchasing/permissions.php');
    $granted = fn (string $role): bool => DB::table('roles as r')->join('role_has_permissions as rp', 'rp.role_id', '=', 'r.id')
        ->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('r.name', $role)->where('p.name', 'purchasing.reports.view')->exists();

    expect($catalog['permissions']['purchasing.reports.view']['roles'])->toEqualCanonicalizing(['Purchasing', 'Accountant', 'Viewer']);

    foreach (['Purchasing', 'Accountant', 'Viewer'] as $role) {
        expect($granted($role))->toBeTrue($role);
    }

    expect($granted('Warehouse'))->toBeFalse();
});

it('rejects invalid parameters with 422', function (string $uri): void {
    ($this->get)($uri)->assertUnprocessable();
})->with([
    'bad date' => ['purchases-by-period?date_from=2027-13-01'],
    'reversed range' => ['by-supplier?date_from=2027-06-10&date_to=2027-06-01'],
    'bad period' => ['purchases-by-period?period=year'],
    'group on a report without groups' => ['by-item?group_by=supplier'],
    'group on supplier performance' => ['supplier-performance?group_by=supplier'],
    'bad open orders group' => ['open-orders?group_by=customer'],
    'bad GRNI group' => ['receipt-vs-invoice?group_by=invoice'],
    'bad ageing group' => ['supplier-ageing?group_by=item'],
    'bad variance group' => ['price-variance?group_by=category'],
    'bad return group' => ['return-rate?group_by=order'],
    'bad savings group' => ['rfq-savings?group_by=item'],
    'bad as_of' => ['supplier-ageing?as_of=15.06.2027'],
    'bad party' => ['by-supplier?party_id=nope'],
    'bad item' => ['open-orders?item_id=1'],
    'bad currency' => ['by-supplier?currency_code=usd'],
    'limit too big' => ['top-suppliers?limit=101'],
    'bad format' => ['price-variance/export?format=pdf'],
    'per page too big' => ['open-orders?per_page=501'],
    'too many days' => ['purchases-by-period?period=day&date_from=2000-01-01&date_to=2027-06-30'],
]);
