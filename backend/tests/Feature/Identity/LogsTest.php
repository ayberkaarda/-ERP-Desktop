<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use App\Modules\Identity\Models\SessionLog;
use App\Modules\Identity\Support\CsvFormulaGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->a = Identity::company(['name' => 'Alpha']);
    $this->b = Identity::company(['name' => 'Beta']);
    $this->adminA = Identity::member($this->a, ['Admin']);
    $this->viewerA = Identity::member($this->a, ['Viewer'], ['name' => 'Viewer A']);
    $this->userB = Identity::member($this->b, ['Viewer'], ['name' => '=HYPERLINK("http://evil")']);

    // One audited change per company.
    Identity::fresh();
    $this->actingAs($this->adminA)->patchJson("/api/v1/users/{$this->viewerA->id}", ['name' => 'Viewer Renamed'], Identity::headers($this->a))->assertOk();
    $adminB = Identity::member($this->b, ['Admin']);
    Identity::fresh();
    $this->actingAs($adminB)->patchJson("/api/v1/users/{$this->userB->id}", ['name' => '@SUM(1+1)'], Identity::headers($this->b))->assertOk();
});

function actingFor(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user);
}

it('lists the audit trail of the active company only, with filters', function (): void {
    $rows = actingFor($this->adminA)->getJson('/api/v1/logs/audit?per_page=100', Identity::headers($this->a))
        ->assertOk()
        ->assertJsonStructure(['data' => [['id', 'event', 'subject_type', 'subject_id', 'causer_id', 'old', 'attributes', 'created_at']], 'meta' => ['pagination']])
        ->json('data');

    expect(collect($rows)->pluck('subject_id'))->not->toContain($this->userB->id)
        ->and(collect($rows)->where('event', 'updated')->firstWhere('subject_id', $this->viewerA->id)['old'] ?? null)->toBe(['name' => 'Viewer A']);

    $filtered = actingFor($this->adminA)
        ->getJson("/api/v1/logs/audit?filter[event]=updated&filter[subject_type]=user&filter[subject_id]={$this->viewerA->id}", Identity::headers($this->a))
        ->assertOk()->json('data');
    expect($filtered)->toHaveCount(1);

    actingFor($this->adminA)->getJson('/api/v1/logs/audit?filter[password]=x', Identity::headers($this->a))->assertStatus(422);
    actingFor($this->adminA)->getJson('/api/v1/logs/audit?from=2020-01-02&to=2020-01-01', Identity::headers($this->a))->assertStatus(422);
    expect(actingFor($this->adminA)->getJson('/api/v1/logs/audit?to=2000-01-01', Identity::headers($this->a))->json('data'))->toBe([]);
});

it('gates the audit trail and its export', function (): void {
    actingFor($this->viewerA)->getJson('/api/v1/logs/audit', Identity::headers($this->a))->assertStatus(403);
    actingFor($this->viewerA)->get('/api/v1/logs/audit/export', Identity::headers($this->a))->assertStatus(403);
    actingFor($this->adminA)->getJson('/api/v1/logs/audit', Identity::headers($this->b))->assertStatus(403);
});

it('exports CSV with formula injection neutralised and only own company rows', function (): void {
    $response = actingFor($this->adminA)->get('/api/v1/logs/audit/export?format=csv', Identity::headers($this->a))->assertOk();
    $csv = $response->streamedContent();

    expect($response->headers->get('content-type'))->toContain('text/csv')
        ->and($csv)->toContain('Viewer Renamed')
        ->and($csv)->not->toContain('@SUM');

    // A cell that starts with a formula trigger is prefixed so spreadsheets treat it as text.
    app(CompanyContext::class)->runAs($this->a->id, fn () => activity()->event('note')->log('=HYPERLINK("http://evil")'));
    $csv = actingFor($this->adminA)->get('/api/v1/logs/audit/export?format=csv', Identity::headers($this->a))->assertOk()->streamedContent();
    $cells = collect(preg_split('/\r?\n/', trim($csv)) ?: [])->flatMap(fn (string $line): array => str_getcsv($line, escape: ''));

    expect($cells)->toContain('\'=HYPERLINK("http://evil")')
        ->and($cells->filter(fn (?string $cell): bool => $cell !== null && $cell !== '' && in_array($cell[0], ['=', '+', '-', '@'], true)))->toBeEmpty();
});

it('neutralises every formula trigger', function (string $value): void {
    expect(CsvFormulaGuard::cell($value))->toBe("'".$value)
        ->and(CsvFormulaGuard::cell('plain'))->toBe('plain')
        ->and(CsvFormulaGuard::cell(null))->toBe('');
})->with(['=1+1', '+1', '-1', '@SUM(A1)', "\tx", "\rx"]);

it('exports XLSX', function (): void {
    $response = actingFor($this->adminA)->get('/api/v1/logs/audit/export?format=xlsx', Identity::headers($this->a))->assertOk();

    expect($response->headers->get('content-disposition'))->toContain('.xlsx');
});

it('refuses exports above the row cap', function (): void {
    config(['identity.audit_export.max_rows' => 1]);

    actingFor($this->adminA)->getJson('/api/v1/logs/audit/export', Identity::headers($this->a))
        ->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR');
});

it('lists session logs of the company members only', function (): void {
    foreach ([[$this->viewerA, SessionEvent::Login], [$this->userB, SessionEvent::Login], [null, SessionEvent::Failed]] as [$user, $event]) {
        SessionLog::query()->create(['user_id' => $user?->id, 'email' => $user?->email ?? 'ghost@example.com', 'event' => $event, 'created_at' => now()]);
    }

    $rows = actingFor($this->adminA)->getJson('/api/v1/logs/sessions', Identity::headers($this->a))
        ->assertOk()->assertJsonStructure(['data' => [['id', 'user_id', 'email', 'event', 'ip_address', 'user_agent', 'created_at']]])
        ->json('data');

    expect(collect($rows)->pluck('user_id')->all())->toBe([$this->viewerA->id]);

    actingFor($this->adminA)->getJson('/api/v1/logs/sessions?filter[event]=failed', Identity::headers($this->a))->assertJsonCount(0, 'data');
    actingFor($this->viewerA)->getJson('/api/v1/logs/sessions', Identity::headers($this->a))->assertStatus(403);

    $root = User::factory()->superAdmin()->create();
    actingFor($root)->getJson('/api/v1/logs/sessions?filter[event]=failed', Identity::headers($this->a))->assertJsonCount(1, 'data');
});
