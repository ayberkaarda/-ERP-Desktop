<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Services\JournalDrafts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->manager = Actors::user(['accounting.periods.manage']);
    $this->closer = Actors::user(['accounting.periods.view', 'accounting.periods.close']);
    $this->reopener = Actors::user(['accounting.periods.reopen']);
});

it('creates a fiscal year with 12 monthly periods and an optional period 13', function (): void {
    $year = Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2028', 'start_date' => '2028-01-01', 'adjustment_period' => true])
        ->assertCreated()
        ->assertJsonPath('data.end_date', '2028-12-31')
        ->assertJsonPath('data.status', 'open')
        ->assertJsonCount(13, 'data.periods')
        ->json('data');

    expect($year['periods'][1])->toMatchArray(['number' => 2, 'start_date' => '2028-02-01', 'end_date' => '2028-02-29', 'status' => 'open'])
        ->and($year['periods'][11])->toMatchArray(['number' => 12, 'start_date' => '2028-12-01', 'end_date' => '2028-12-31'])
        ->and($year['periods'][12])->toMatchArray(['number' => 13, 'is_adjustment' => true, 'start_date' => '2028-12-31', 'end_date' => '2028-12-31']);

    Books::as($this->manager, $this->company)->getJson('/api/v1/fiscal-years?sort=start_date')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.1.code', '2028');
    Books::as($this->manager, $this->company)->getJson("/api/v1/fiscal-years/{$year['id']}")->assertOk()->assertJsonPath('data.code', '2028');
});

it('splits a short first year and a shifted year at month ends', function (): void {
    $short = Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2026', 'start_date' => '2026-09-15', 'end_date' => '2026-12-31'])
        ->assertCreated()->assertJsonCount(4, 'data.periods')->json('data.periods');
    expect($short[0])->toMatchArray(['start_date' => '2026-09-15', 'end_date' => '2026-09-30']);

    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => 'FY28', 'start_date' => '2028-07-01'])
        ->assertCreated()->assertJsonPath('data.end_date', '2029-06-30')->assertJsonCount(12, 'data.periods')
        ->assertJsonPath('data.periods.11.end_date', '2029-06-30');

    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => 'LONG', 'start_date' => '2030-01-15', 'end_date' => '2031-01-14'])
        ->assertStatus(422)->assertJsonValidationErrors(['end_date'], 'errors.fields');
});

it('refuses overlapping years, duplicate codes and bad payloads', function (): void {
    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => 'X27', 'start_date' => '2027-06-01'])
        ->assertStatus(422)->assertJsonValidationErrors(['start_date'], 'errors.fields');
    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2027', 'start_date' => '2030-01-01'])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2031', 'start_date' => '2031-12-01', 'end_date' => '2031-01-01'])
        ->assertStatus(422)->assertJsonValidationErrors(['end_date'], 'errors.fields');

    // Another company may use the same dates and code.
    $other = Books::company();
    Books::postJson(Actors::user(['accounting.periods.manage'], $other), $other, 'fiscal-years', ['code' => '2030', 'start_date' => '2030-01-01'])->assertCreated();
    Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2030', 'start_date' => '2030-01-01'])->assertCreated();
});

it('changes dates only while the year has no entries, with version locking', function (): void {
    $year = Books::postJson($this->manager, $this->company, 'fiscal-years', ['code' => '2029', 'start_date' => '2029-01-01'])->json('data');

    Books::as($this->manager, $this->company)->patchJson("/api/v1/fiscal-years/{$year['id']}", ['end_date' => '2029-09-30'])
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/fiscal-years/{$year['id']}", ['start_date' => '2029-01-01', 'end_date' => '2029-09-30', 'name' => 'Short', 'version' => 1])
        ->assertOk()->assertJsonCount(9, 'data.periods')->assertJsonPath('data.name', 'Short')->assertJsonPath('data.version', 2);
    Books::as($this->manager, $this->company)->patchJson("/api/v1/fiscal-years/{$year['id']}", ['name' => 'Stale', 'version' => 1])
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');

    $current = Books::fiscalYear($this->company, '2027');
    Books::post($this->company, '2027-02-02', [['100', '1', '0'], ['600', '0', '1']]);
    Books::as($this->manager, $this->company)->patchJson("/api/v1/fiscal-years/{$current->id}", ['end_date' => '2027-11-30', 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['start_date'], 'errors.fields');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/fiscal-years/{$current->id}", ['name' => 'Mali yıl 2027', 'version' => 1])
        ->assertOk()->assertJsonPath('data.name', 'Mali yıl 2027');
});

it('soft-closes, closes and reopens periods with reasons and audit', function (): void {
    $march = Books::period($this->company, '2027', 3);

    Books::postJson($this->closer, $this->company, "accounting-periods/{$march->id}/soft-close")->assertOk()->assertJsonPath('data.status', 'soft_closed');
    Books::postJson($this->closer, $this->company, "accounting-periods/{$march->id}/soft-close")->assertStatus(422);
    Books::postJson($this->closer, $this->company, "accounting-periods/{$march->id}/close", ['version' => 1])->assertStatus(409);
    Books::postJson($this->closer, $this->company, "accounting-periods/{$march->id}/close", ['version' => 2])->assertOk()->assertJsonPath('data.status', 'closed');

    Books::postJson($this->closer, $this->company, "accounting-periods/{$march->id}/reopen", ['reason' => 'audit'])->assertForbidden();
    Books::postJson($this->reopener, $this->company, "accounting-periods/{$march->id}/reopen", [])
        ->assertStatus(422)->assertJsonValidationErrors(['reason'], 'errors.fields');
    Books::postJson($this->reopener, $this->company, "accounting-periods/{$march->id}/reopen", ['reason' => 'late bank statement'])
        ->assertOk()->assertJsonPath('data.status', 'open');

    $audit = DB::table('activity_log')->where('subject_id', $march->id)->where('event', 'status_changed')->orderBy('created_at')->orderBy('id')->get();
    expect($audit)->toHaveCount(3)
        ->and(json_decode((string) $audit[2]->properties, true))->toMatchArray(['from' => 'closed', 'to' => 'open', 'reason' => 'late bank statement'])
        ->and($audit[2]->causer_id)->toBe($this->reopener->id);
});

it('blocks closing a period that still has drafts and lists the draft count', function (): void {
    $april = Books::period($this->company, '2027', 4);
    Books::in($this->company, fn () => app(JournalDrafts::class)->create([
        'entry_type' => 'general', 'entry_date' => '2027-04-10', 'lines' => [['account_code' => '100', 'debit' => '5']],
    ], null));

    Books::postJson($this->closer, $this->company, "accounting-periods/{$april->id}/close")
        ->assertStatus(422)->assertJsonValidationErrors(['status'], 'errors.fields');
    Books::as($this->closer, $this->company)->getJson('/api/v1/accounting-periods?filter[number]=4')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.draft_count', 1);
    Books::as($this->closer, $this->company)->getJson("/api/v1/accounting-periods/{$april->id}")->assertOk()->assertJsonPath('data.draft_count', 1);
    Books::postJson($this->closer, $this->company, "accounting-periods/{$april->id}/soft-close")->assertOk();
});

it('lists periods filtered by year and keeps other companies out', function (): void {
    $year = Books::fiscalYear($this->company, '2027');
    Books::as($this->closer, $this->company)->getJson("/api/v1/accounting-periods?filter[fiscal_year_id]={$year->id}&sort=number&per_page=50")
        ->assertOk()->assertJsonCount(12, 'data')->assertJsonPath('data.0.number', 1);

    $other = Books::company();
    $foreign = Books::period($other, '2027', 1);
    Books::as($this->closer, $this->company)->getJson("/api/v1/accounting-periods/{$foreign->id}")->assertNotFound();
    Books::postJson($this->closer, $this->company, "accounting-periods/{$foreign->id}/close")->assertNotFound();
    expect(Books::in($other, fn () => AccountingPeriod::query()->findOrFail($foreign->id))->status->value)->toBe('open');
});

it('does not reopen periods of a closed year', function (): void {
    $year = Books::fiscalYear($this->company, '2027');
    Books::postJson(Actors::user(['accounting.year.close']), $this->company, "fiscal-years/{$year->id}/close")->assertOk();
    $june = Books::period($this->company, '2027', 6);

    Books::postJson($this->reopener, $this->company, "accounting-periods/{$june->id}/reopen", ['reason' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors(['status'], 'errors.fields');
});
