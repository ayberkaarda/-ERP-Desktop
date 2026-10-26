<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Models\JournalLine;
use App\Modules\Assistant\Contracts\ToolExecutionContext;
use App\Modules\Assistant\Tools\ToolRegistry;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Tools\Request;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->world = SalesKit::world(false);
    $this->actor = Actors::user(['assistant.use', 'accounting.entries.create'], $this->world->company);
    Actors::activate($this->world->company);
    config(['assistant.enabled' => true]);
    $this->tool = collect(app(ToolRegistry::class)->forUser($this->actor))->first(fn ($tool): bool => $tool->name() === 'draft_journal_entry');
    $this->arguments = ['entry_date' => '2027-06-15', 'description' => 'Receivable draft', 'lines' => [
        ['account_code' => '120', 'debit' => '10', 'credit' => '0'],
        ['account_code' => '100', 'debit' => '0', 'credit' => '10'],
    ]];
});

afterEach(function (): void {
    Carbon::setTestNow();
});

it('preserves approved party and dimensions on a journal draft without posting', function (): void {
    $center = CostCenter::factory()->create();
    $project = Project::factory()->create();
    Account::query()->where('code', '120')->update(['requires_cost_center' => true, 'requires_project' => true]);
    $this->arguments['lines'][0] += ['party_id' => $this->world->party->id, 'cost_center_id' => $center->id, 'project_id' => $project->id];

    $output = app(ToolExecutionContext::class)->withApprovedCalls(['journal-dimensions'], fn (): string => $this->tool->handle(new Request($this->arguments, 'journal-dimensions')));
    $result = json_decode($output, true, flags: JSON_THROW_ON_ERROR)['untrusted_data'];
    $entry = JournalEntry::query()->findOrFail($result['id']);
    $line = JournalLine::query()->where('entry_id', $entry->id)->where('line_no', 1)->firstOrFail();

    expect($entry->status->value)->toBe('draft')->and($entry->posted_at)->toBeNull()
        ->and($line->party_id)->toBe($this->world->party->id)
        ->and($line->cost_center_id)->toBe($center->id)
        ->and($line->project_id)->toBe($project->id);
});

it('rejects foreign journal party and dimension references even after approval', function (string $field): void {
    $other = SalesKit::company();
    Actors::activate($other);
    $foreign = match ($field) {
        'party_id' => SalesKit::party($other)->id,
        'cost_center_id' => CostCenter::factory()->create()->id,
        'project_id' => Project::factory()->create()->id,
    };
    Actors::activate($this->world->company);
    $this->arguments['lines'][0][$field] = $foreign;

    expect(fn () => app(ToolExecutionContext::class)->withApprovedCalls(['journal-dimensions'], fn (): string => $this->tool->handle(new Request($this->arguments, 'journal-dimensions'))))->toThrow(ValidationException::class);
    expect(JournalEntry::query()->count())->toBe(0);
})->with(['party_id', 'cost_center_id', 'project_id']);
