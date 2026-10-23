<?php

declare(strict_types=1);

use App\Modules\Assistant\Agents\ErpAssistant;
use App\Modules\Assistant\Enums\MessageStatus;
use App\Modules\Assistant\Enums\ToolStatus;
use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Models\Message;
use App\Modules\Assistant\Models\ToolCall;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config(['assistant.enabled' => false, 'assistant.provider' => 'openai', 'assistant.model' => 'test-model']);
    $this->company = Actors::company();
    $this->user = Actors::user(['assistant.use', 'assistant.usage.view']);
    Actors::activate($this->company);
    Sanctum::actingAs($this->user);
    $this->headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid7()];
});

it('returns disabled status without disclosing provider configuration', function (): void {
    ErpAssistant::fake()->preventStrayPrompts();
    $this->getJson('/api/v1/assistant/status', $this->headers)->assertOk()->assertJsonPath('data.enabled', false)->assertJsonPath('data.provider', null)->assertJsonPath('data.can_admin', true);
    ErpAssistant::assertNeverPrompted();
});

it('rejects all nonstatus routes when disabled before request validation', function (string $method, string $path): void {
    ErpAssistant::fake()->preventStrayPrompts();
    $this->json($method, '/api/v1/assistant/'.$path, [], $this->headers)->assertStatus(503)->assertJsonPath('errors.code', 'ASSISTANT_DISABLED');
    ErpAssistant::assertNeverPrompted();
})->with([
    ['GET', 'conversations'], ['POST', 'conversations'], ['GET', 'usage'],
    ['GET', 'conversations/00000000-0000-0000-0000-000000000001'],
    ['POST', 'conversations/00000000-0000-0000-0000-000000000001/messages'],
    ['POST', 'conversations/00000000-0000-0000-0000-000000000001/approvals/00000000-0000-0000-0000-000000000002'],
]);

it('requires a valid provider configuration after explicit enablement', function (): void {
    config(['assistant.enabled' => true, 'assistant.provider' => 'unknown']);
    $this->getJson('/api/v1/assistant/conversations', $this->headers)->assertStatus(503)->assertJsonPath('errors.code', 'ASSISTANT_NOT_CONFIGURED');
});

it('creates a conversation and streams a safe canonical response', function (): void {
    config(['assistant.enabled' => true]);
    ErpAssistant::fake(['Hello user@example.com']);
    $created = $this->postJson('/api/v1/assistant/conversations', [], $this->headers)->assertCreated()->json('data.id');
    $response = $this->postJson('/api/v1/assistant/conversations/'.$created.'/messages', ['message' => 'Hello', 'request_id' => (string) Str::uuid7()], $this->headers)->assertOk()->assertHeader('Content-Type', 'text/event-stream; charset=UTF-8');
    $stream = $response->streamedContent();
    expect($stream)->toContain('event: start', 'event: delta', 'event: done', '[email]')->not->toContain('user@example.com');
});

it('rejects arbitrary record context types and malformed identifiers', function (): void {
    config(['assistant.enabled' => true]);
    ErpAssistant::fake()->preventStrayPrompts();
    $conversation = Conversation::query()->create(['company_id' => $this->company, 'user_id' => $this->user->id, 'title' => 'Context']);
    $this->postJson('/api/v1/assistant/conversations/'.$conversation->id.'/messages', ['message' => 'Read this', 'request_id' => (string) Str::uuid7(), 'context' => [['type' => 'raw_sql', 'id' => 'bad']]], $this->headers)->assertUnprocessable()->assertJsonValidationErrors(['context.0.type', 'context.0.id'], 'errors.fields');
    ErpAssistant::assertNeverPrompted();
});

it('returns a localized default conversation title', function (): void {
    config(['assistant.enabled' => true]);
    $this->postJson('/api/v1/assistant/conversations', [], [...$this->headers, 'Accept-Language' => 'tr'])->assertCreated()->assertJsonPath('data.title', 'Yeni konuşma');
});

it('checks current assistant permission before replaying a cached conversation creation', function (): void {
    config(['assistant.enabled' => true]);
    $body = ['title' => 'Private conversation'];
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertCreated();
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
    config(['assistant.enabled' => false]);
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertStatus(503)->assertJsonPath('errors.code', 'ASSISTANT_DISABLED');
    config(['assistant.enabled' => true]);
    Actors::revoke($this->user, $this->company);
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertForbidden()->assertJsonPath('errors.code', 'FORBIDDEN');
    expect(Conversation::query()->count())->toBe(1);
});

it('checks current assistant permission before replaying a cached approval response', function (): void {
    config(['assistant.enabled' => true]);
    $conversation = Conversation::query()->create(['company_id' => $this->company, 'user_id' => $this->user->id, 'title' => 'Private approval']);
    $message = Message::query()->create(['conversation_id' => $conversation->id, 'company_id' => $this->company, 'user_id' => $this->user->id, 'request_id' => (string) Str::uuid7(), 'role' => 'assistant', 'status' => MessageStatus::PendingApproval, 'content' => 'Private preview', 'context' => [], 'sdk_messages' => []]);
    $call = ToolCall::query()->create(['message_id' => $message->id, 'conversation_id' => $conversation->id, 'company_id' => $this->company, 'user_id' => $this->user->id, 'provider_call_id' => 'test-call', 'tool' => 'draft_test', 'kind' => 'draft', 'status' => ToolStatus::Pending, 'arguments' => [], 'preview' => []]);
    $url = '/api/v1/assistant/conversations/'.$conversation->id.'/approvals/'.$call->id;
    $this->postJson($url, ['decision' => 'reject'], $this->headers)->assertOk();
    $this->postJson($url, ['decision' => 'reject'], $this->headers)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
    config(['assistant.enabled' => false]);
    $this->postJson($url, ['decision' => 'reject'], $this->headers)->assertStatus(503)->assertJsonPath('errors.code', 'ASSISTANT_DISABLED');
    config(['assistant.enabled' => true]);
    Actors::revoke($this->user, $this->company);
    $this->postJson($url, ['decision' => 'reject'], $this->headers)->assertForbidden()->assertJsonPath('errors.code', 'FORBIDDEN');
});

it('checks a forced password change before replaying a cached response', function (): void {
    config(['assistant.enabled' => true]);
    $body = ['title' => 'Password guard'];
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertCreated();
    $this->user->forceFill(['must_change_password' => true])->save();
    $this->postJson('/api/v1/assistant/conversations', $body, $this->headers)->assertForbidden()->assertJsonPath('errors.code', 'PASSWORD_CHANGE_REQUIRED');
});
