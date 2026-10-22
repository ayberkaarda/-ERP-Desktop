<?php

declare(strict_types=1);

use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Exceptions\AccountNotDetermined;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->admin = Actors::user(['accounting.determination.manage']);
});

it('seeds one default rule per known event whose TDHP account exists', function (): void {
    $rules = Books::in($this->company, fn () => AccountDeterminationRule::query()->with('account')->where('is_system', true)->get()->mapWithKeys(fn ($r) => [$r->event_key => $r->account->code]));

    expect($rules->all())->toMatchArray([
        'sales.receivable' => '120', 'sales.revenue.goods' => '600', 'sales.vat_output' => '391', 'sales.returns' => '610',
        'purchase.payable' => '320', 'purchase.expense' => '770', 'purchase.vat_input' => '191', 'purchase.vat_withholding' => '360',
        'inventory.stock' => '153', 'inventory.cogs' => '621', 'treasury.cash' => '100', 'treasury.bank' => '102',
        'treasury.cheque_portfolio' => '101', 'fx.gain' => '646', 'fx.loss' => '656', 'purchase.price_variance' => '621',
    ])->and($rules)->toHaveCount(18) // plus inventory.opening_offset (500), seeded by Inventory
        // 381 (goods received not invoiced) is not in this fixture chart, so its rule is skipped.
        ->and($rules->has('purchase.goods_received'))->toBeFalse();
});

it('resolves the highest priority matching rule and falls back to the default', function (): void {
    $export = Books::postJson($this->admin, $this->company, 'accounts', ['code' => '600.02', 'name' => 'Yurt dışı', 'parent_code' => '600']);
    expect($export->status())->toBe(403);

    $manager = Actors::user(['accounting.accounts.manage', 'accounting.determination.manage']);
    $domestic = Books::postJson($manager, $this->company, 'accounts', ['code' => '600.01', 'name' => 'Yurt içi', 'parent_code' => '600'])->json('data');
    $foreign = Books::postJson($manager, $this->company, 'accounts', ['code' => '600.02', 'name' => 'Yurt dışı', 'parent_code' => '600'])->json('data');

    // 600 became a heading, so the seeded default is skipped until it points at a leaf.
    $default = Books::in($this->company, fn () => AccountDeterminationRule::query()->where('event_key', 'sales.revenue.goods')->firstOrFail());
    Books::as($manager, $this->company)->patchJson("/api/v1/account-determination-rules/{$default->id}", ['account_id' => $domestic['id'], 'version' => 1])
        ->assertOk()->assertJsonPath('data.account_code', '600.01');

    Books::postJson($manager, $this->company, 'account-determination-rules', [
        'event_key' => 'sales.revenue.goods', 'priority' => 10, 'conditions' => ['currency' => ['USD', 'EUR']], 'account_id' => $foreign['id'],
    ])->assertCreated()->assertJsonPath('data.conditions.currency.0', 'USD');
    Books::postJson($manager, $this->company, 'account-determination-rules', [
        'event_key' => 'sales.revenue.goods', 'priority' => 20, 'conditions' => ['currency' => 'USD', 'party_group' => 'export'], 'account_id' => $domestic['id'], 'side' => 'credit',
    ])->assertCreated();

    $resolve = fn (array $context) => Books::in($this->company, fn () => app(AccountDeterminer::class)->resolve('sales.revenue.goods', $context));

    expect($resolve([])->code)->toBe('600.01')
        ->and($resolve(['currency' => 'TRY'])->code)->toBe('600.01')
        ->and($resolve(['currency' => 'EUR'])->code)->toBe('600.02')
        ->and($resolve(['currency' => 'USD', 'party_group' => 'export'])->side)->toBe('credit')
        ->and($resolve(['currency' => 'USD', 'party_group' => 'retail'])->code)->toBe('600.02');

    Books::postJson($manager, $this->company, 'account-determination/test', ['event_key' => 'sales.revenue.goods', 'context' => ['currency' => 'EUR']])
        ->assertOk()->assertJsonPath('data.account.code', '600.02')->assertJsonPath('data.side', null);
});

it('supports wildcard event keys and reports unresolvable events as 422', function (): void {
    $cash = Books::account($this->company, '100');
    Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'payroll.*', 'account_id' => $cash->id])->assertCreated();

    expect(Books::in($this->company, fn () => app(AccountDeterminer::class)->resolve('payroll.net_pay')->code))->toBe('100');
    expect(fn () => Books::in($this->company, fn () => app(AccountDeterminer::class)->resolve('unknown.event')))->toThrow(AccountNotDetermined::class);

    Books::postJson($this->admin, $this->company, 'account-determination/test', ['event_key' => 'unknown.event'])
        ->assertStatus(422)->assertJsonValidationErrors(['event_key'], 'errors.fields');
});

it('validates rules and protects the seeded defaults', function (): void {
    $heading = Books::account($this->company, '10');
    $foreign = Books::account(Books::company(), '100');

    Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'Sales Revenue', 'account_id' => Books::account($this->company, '100')->id])
        ->assertStatus(422)->assertJsonValidationErrors(['event_key'], 'errors.fields');
    Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'sales.x', 'account_id' => $heading->id])
        ->assertStatus(422)->assertJsonValidationErrors(['account_id'], 'errors.fields');
    Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'sales.x', 'account_id' => $foreign->id])
        ->assertStatus(422)->assertJsonValidationErrors(['account_id'], 'errors.fields');
    Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'sales.x', 'account_id' => Books::account($this->company, '100')->id, 'conditions' => ['colour' => 'red']])
        ->assertStatus(422)->assertJsonValidationErrors(['conditions'], 'errors.fields');

    $system = Books::in($this->company, fn () => AccountDeterminationRule::query()->where('event_key', 'treasury.cash')->firstOrFail());
    Books::as($this->admin, $this->company)->deleteJson("/api/v1/account-determination-rules/{$system->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['rule'], 'errors.fields');
    Books::as($this->admin, $this->company)->patchJson("/api/v1/account-determination-rules/{$system->id}", ['event_key' => 'treasury.other', 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['event_key'], 'errors.fields');
    Books::as($this->admin, $this->company)->patchJson("/api/v1/account-determination-rules/{$system->id}", ['is_active' => false, 'version' => 1])
        ->assertOk()->assertJsonPath('data.is_active', false);
    expect(fn () => Books::in($this->company, fn () => app(AccountDeterminer::class)->resolve('treasury.cash')))->toThrow(AccountNotDetermined::class);

    $custom = Books::postJson($this->admin, $this->company, 'account-determination-rules', ['event_key' => 'treasury.pos', 'account_id' => Books::account($this->company, '102')->id])->json('data');
    Books::as($this->admin, $this->company)->getJson('/api/v1/account-determination-rules?filter[event_key]=treasury.pos')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.account_code', '102');
    Books::as($this->admin, $this->company)->getJson("/api/v1/account-determination-rules/{$custom['id']}")->assertOk();
    Books::as($this->admin, $this->company)->deleteJson("/api/v1/account-determination-rules/{$custom['id']}")->assertNoContent();
});
