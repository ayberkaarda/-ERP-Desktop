<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MissingCompanyContext;
use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Notifications\Events\NotificationCreated;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Services\NotificationService;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\Support\Svc\SvcActors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    SvcActors::install();
    $this->company = SvcActors::company();
    $this->me = SvcActors::user();
    $this->other = SvcActors::user();

    SvcActors::activate($this->company);
    $this->notifier = app(Notifier::class);
    $this->make = fn ($user, string $title = 'Hi') => $this->notifier->notify($user->id, 'invoice.approved', ['title' => $title, 'body' => 'Body', 'url' => '/x']);

    $this->api = fn ($user = null, ?string $company = null) => tap($this, fn () => Auth::forgetGuards())
        ->actingAs($user ?? $this->me, 'web')
        ->withHeader('X-Company-Id', $company ?? $this->company);
});

it('is exposed through the contract and accepts a user object', function (): void {
    expect($this->notifier)->toBeInstanceOf(NotificationService::class);

    $id = app(NotificationService::class)->notify($this->me, 't', ['title' => 'a', 'body' => 'b']);

    expect(Notification::query()->findOrFail($id)->user_id)->toBe($this->me->id);
});

it('requires title and body and an active company', function (): void {
    expect(fn () => $this->notifier->notify($this->me->id, 't', ['title' => 'x']))->toThrow(InvalidArgumentException::class);

    app(CompanyContext::class)->clear();
    expect(fn () => $this->notifier->notify($this->me->id, 't', ['title' => 'x', 'body' => 'y']))->toThrow(MissingCompanyContext::class);
});

it('broadcasts on the private user channel after commit', function (): void {
    Event::fake([NotificationCreated::class]);

    $id = app(Notifier::class)->notify($this->me->id, 'invoice.approved', ['title' => 'Hi', 'body' => 'Body', 'url' => '/x']);

    Event::assertDispatched(NotificationCreated::class, function (NotificationCreated $e) use ($id): bool {
        expect($e)->toBeInstanceOf(ShouldBroadcast::class)
            ->and($e->afterCommit)->toBeTrue()
            ->and($e->broadcastAs())->toBe('notification.created')
            ->and($e->broadcastOn()[0])->toBeInstanceOf(PrivateChannel::class)
            ->and($e->broadcastOn()[0]->name)->toBe('private-user.'.$this->me->id)
            ->and($e->broadcastWith())->toMatchArray(['id' => $id, 'type' => 'invoice.approved', 'read_at' => null])
            ->and($e->broadcastWith()['data'])->toMatchArray(['title' => 'Hi', 'body' => 'Body', 'url' => '/x']);

        return true;
    });
});

it('lists only my notifications of the active company, newest first, with unread count', function (): void {
    $first = ($this->make)($this->me, 'one');
    ($this->make)($this->me, 'two');
    ($this->make)($this->other, 'theirs');
    Notification::query()->findOrFail($first)->forceFill(['read_at' => now()])->save();

    $res = ($this->api)()->getJson('/api/v1/notifications')->assertOk();
    $res->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.unread_count', 1)
        ->assertJsonPath('meta.pagination.total', 2)
        ->assertJsonPath('data.0.data.title', 'two')
        ->assertJsonStructure(['data' => [['id', 'type', 'data' => ['title', 'body', 'url'], 'read_at', 'created_at']]]);

    ($this->api)()->getJson('/api/v1/notifications?unread=1')
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.data.title', 'two');

    ($this->api)(null, SvcActors::company())->getJson('/api/v1/notifications')
        ->assertJsonCount(0, 'data')->assertJsonPath('meta.unread_count', 0);
});

it('rejects unknown list parameters', function (): void {
    ($this->api)()->getJson('/api/v1/notifications?sort=data')->assertStatus(422);
});

it('marks one notification read', function (): void {
    $id = app(Notifier::class)->notify($this->me->id, 'invoice.approved', ['title' => 'Hi', 'body' => 'Body', 'url' => '/x']);

    ($this->api)()->patchJson("/api/v1/notifications/{$id}/read")
        ->assertOk()->assertJsonPath('data.id', $id)->assertJsonPath('data.read_at', fn ($v) => is_string($v));

    ($this->api)()->getJson('/api/v1/notifications')->assertJsonPath('meta.unread_count', 0);
});

it('answers 404 for other users, other companies and malformed ids', function (): void {
    $theirs = ($this->make)($this->other);

    ($this->api)()->patchJson("/api/v1/notifications/{$theirs}/read")
        ->assertNotFound()->assertJsonPath('errors.code', 'NOT_FOUND');
    ($this->api)($this->other, SvcActors::company())->patchJson("/api/v1/notifications/{$theirs}/read")->assertNotFound();
    ($this->api)()->patchJson('/api/v1/notifications/not-a-uuid/read')->assertNotFound();

    SvcActors::activate($this->company);
    expect(Notification::query()->findOrFail($theirs)->read_at)->toBeNull();
});

it('marks only my unread notifications read with read-all', function (): void {
    ($this->make)($this->me);
    ($this->make)($this->me);
    $theirs = ($this->make)($this->other);

    ($this->api)()->postJson('/api/v1/notifications/read-all')->assertOk()->assertJsonPath('data.updated', 2);
    ($this->api)()->postJson('/api/v1/notifications/read-all')->assertJsonPath('data.updated', 0);

    SvcActors::activate($this->company);
    expect(Notification::query()->findOrFail($theirs)->read_at)->toBeNull();
});

it('requires authentication and a company', function (): void {
    Auth::forgetGuards();
    $this->getJson('/api/v1/notifications')->assertUnauthorized();
    $this->actingAs($this->me, 'web')->getJson('/api/v1/notifications')->assertStatus(400);
});
