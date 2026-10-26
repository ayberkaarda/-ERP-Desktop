<?php

declare(strict_types=1);

use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\JournalEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->admin = Actors::user(['settings.view', 'settings.update', 'accounting.year.close', 'accounting.accounts.manage']);
});

it('registers the accounting settings with their defaults', function (): void {
    $settings = collect(Books::as($this->admin, $this->company)->getJson('/api/v1/settings')->assertOk()->json('data'));
    $value = fn (string $key) => $settings->firstWhere('key', $key)['value'] ?? null;

    expect($value('accounting.expense_scheme'))->toBe('7A')
        ->and($value('accounting.account_code_prefix_rule'))->toBeTrue()
        ->and($value('accounting.closing_mapping'))->toMatchArray(['result_account' => '690', 'profit_account' => '590', 'loss_account' => '591']);
});

it('validates the closing mapping and closes with a configured one', function (): void {
    Books::as($this->admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['accounting.closing_mapping' => ['result_acount' => '690']]])
        ->assertStatus(422);
    Books::as($this->admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['accounting.closing_mapping' => ['income_statement_groups' => [6, 12]]]])
        ->assertStatus(422);
    Books::as($this->admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['accounting.expense_scheme' => '7C']])->assertStatus(422);

    // Profit goes to a company-specific retained earnings account instead of 590.
    Books::postJson($this->admin, $this->company, 'accounts', ['code' => '570', 'name' => 'Geçmiş yıllar kârları', 'parent_code' => '5']);
    Books::as($this->admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['accounting.closing_mapping' => ['profit_account' => '570']]])->assertOk();

    Books::post($this->company, '2027-01-02', [['100', '100', '0'], ['600', '0', '100']], EntryType::General);
    Books::postJson($this->admin, $this->company, 'fiscal-years/'.Books::fiscalYear($this->company, '2027')->id.'/close')->assertOk();

    expect(Books::balance($this->company, '570', '2028-01-01'))->toBe('-100.0000')
        ->and(Books::balance($this->company, '590', '2028-01-01'))->toBe('0.0000')
        ->and(Books::in($this->company, fn () => JournalEntry::query()->where('entry_type', 'opening')->count()))->toBe(1);
});
