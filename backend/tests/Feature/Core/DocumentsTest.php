<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Documents\DocumentTransitioned;
use App\Core\Documents\InvalidStateTransition;
use App\Core\Documents\VersionConflictException;
use Illuminate\Auth\GenericUser;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\Fixtures\FixtureDocument;
use Tests\Fixtures\FixtureDocumentMachine;
use Tests\Fixtures\FixtureStatus;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    FixtureDocument::createTable();
    app(CompanyContext::class)->set((string) Str::uuid7());
    $this->doc = FixtureDocument::create(['name' => 'doc']);
    $this->machine = new FixtureDocumentMachine;
});

it('starts at version 1 and bumps once per update', function (): void {
    expect($this->doc->version)->toBe(1);

    $this->doc->update(['name' => 'x']);
    expect($this->doc->version)->toBe(2);

    $this->doc->bumpVersion()->bumpVersion();
    $this->doc->name = 'y';
    $this->doc->save();

    expect($this->doc->fresh()?->version)->toBe(3);
});

it('raises a 409 version conflict on stale payloads', function (): void {
    $this->doc->assertVersion(1);

    expect(fn () => $this->doc->assertVersion(0))->toThrow(VersionConflictException::class);

    Route::get('/api/v1/_probe/version', fn () => $this->doc->assertVersion(9));
    $this->getJson('/api/v1/_probe/version')->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
});

it('transitions along the map and fires the event after commit', function (): void {
    Event::fake([DocumentTransitioned::class]);
    $actor = new GenericUser(['id' => 'u-1']);

    DB::transaction(function () use ($actor): void {
        $this->machine->transition($this->doc, FixtureStatus::Submitted, $actor);
        Event::assertNotDispatched(DocumentTransitioned::class);
    });

    expect($this->doc->status)->toBe(FixtureStatus::Submitted)
        ->and($this->doc->fresh()?->status)->toBe(FixtureStatus::Submitted)
        ->and($this->doc->version)->toBe(2)
        ->and($this->machine->calls)->toBe(['before:draft>submitted', 'after:draft>submitted']);

    Event::assertDispatched(DocumentTransitioned::class, fn (DocumentTransitioned $e): bool => $e->from === 'draft'
        && $e->to === 'submitted'
        && $e->actorId === 'u-1'
        && $e->document->is($this->doc));
});

it('does not fire the event when the outer transaction rolls back', function (): void {
    Event::fake([DocumentTransitioned::class]);

    try {
        DB::transaction(function (): void {
            $this->machine->transition($this->doc, 'submitted');

            throw new LogicException('abort');
        });
    } catch (LogicException $e) {
        expect($e->getMessage())->toBe('abort');
    }

    Event::assertNotDispatched(DocumentTransitioned::class);
    expect(FixtureDocument::findOrFail($this->doc->id)->status)->toBe(FixtureStatus::Draft);
});

it('rejects transitions outside the map with 422', function (): void {
    expect(fn () => $this->machine->transition($this->doc, 'posted'))->toThrow(InvalidStateTransition::class);
    expect($this->doc->fresh()?->status)->toBe(FixtureStatus::Draft)
        ->and($this->machine->can('draft', 'submitted'))->toBeTrue()
        ->and($this->machine->allowedFrom(FixtureStatus::Posted))->toBe([]);

    Route::get('/api/v1/_probe/transition', fn () => $this->machine->transition($this->doc, 'posted'));
    $this->getJson('/api/v1/_probe/transition')->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
});

it('rejects a stale copy before guards run and never resets the version', function (): void {
    $stale = FixtureDocument::findOrFail($this->doc->id);
    $this->machine->transition($this->doc, 'submitted');
    $this->machine->transition($this->doc, 'approved');
    $this->machine->calls = [];

    expect(fn () => $this->machine->transition($stale, 'cancelled'))->toThrow(VersionConflictException::class);
    expect($this->machine->calls)->toBe([])
        ->and($this->doc->fresh()?->status)->toBe(FixtureStatus::Approved)
        ->and($this->doc->fresh()?->version)->toBe(3);
});

it('gives guards the full locked row, keeping only the caller pending edits', function (): void {
    $copy = FixtureDocument::findOrFail($this->doc->id);
    DB::table('fixture_documents')->where('id', $this->doc->id)->update(['number' => 'N-1']);
    $copy->name = 'edited';
    $seen = [];
    $this->machine->onBefore = function ($model) use (&$seen): void {
        $seen = [$model->number, $model->name];
    };

    $this->machine->transition($copy, 'submitted');

    expect($seen)->toBe(['N-1', 'edited'])
        ->and(FixtureDocument::findOrFail($this->doc->id)->only(['number', 'name', 'version']))
        ->toBe(['number' => 'N-1', 'name' => 'edited', 'version' => 2]);
});

it('cannot transition a retained model of another company', function (): void {
    app(CompanyContext::class)->set((string) Str::uuid7());

    expect(fn () => $this->machine->transition($this->doc, 'submitted'))->toThrow(ModelNotFoundException::class);
    expect(FixtureDocument::withoutCompanyScope()->findOrFail($this->doc->id)->status)->toBe(FixtureStatus::Draft)
        ->and($this->machine->calls)->toBe([]);
});

it('detects a concurrent save atomically instead of overwriting it', function (): void {
    $first = FixtureDocument::findOrFail($this->doc->id);
    $second = FixtureDocument::findOrFail($this->doc->id);

    $first->assertVersion(1);
    $second->assertVersion(1);
    $first->update(['name' => 'first']);

    expect(fn () => $second->update(['name' => 'second']))->toThrow(VersionConflictException::class);
    expect(FixtureDocument::findOrFail($this->doc->id)->only(['name', 'version']))->toBe(['name' => 'first', 'version' => 2])
        ->and($second->version)->toBe(1);
});

it('casts money and decimals as BigDecimal strings, never floats', function (): void {
    $this->doc->update(['total' => '10.12345', 'quantity' => 3, 'rate' => '1.005']);
    $fresh = $this->doc->fresh();

    expect((string) $fresh?->total)->toBe('10.1235')
        ->and((string) $fresh?->quantity)->toBe('3.000000')
        ->and((string) $fresh?->rate)->toBe('1.01')
        ->and(DB::table('fixture_documents')->value('total'))->toBe('10.1235');

    expect(fn () => $this->doc->update(['total' => 1.5]))->toThrow(InvalidArgumentException::class);

    $this->doc->update(['total' => null]);
    expect($this->doc->fresh()?->total)->toBeNull();
});
