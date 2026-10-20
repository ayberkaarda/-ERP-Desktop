<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Models\Activity;
use App\Modules\Identity\Models\Role;
use App\Modules\Organization\Models\Branch;
use App\Modules\Organization\Models\Company;
use App\Modules\Organization\Models\Department;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->a = Identity::company(['name' => 'Alpha']);
    $this->b = Identity::company(['name' => 'Beta']);
    $this->adminA = Identity::member($this->a, ['Admin']);
    $this->viewerA = Identity::member($this->a, ['Viewer']);
    $this->root = User::factory()->superAdmin()->create();
});

function actor(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user);
}

function branchIn(Company $company, array $attributes = []): Branch
{
    return app(CompanyContext::class)->runAs($company->id, fn (): Branch => Branch::factory()->create($attributes));
}

it('lets only super admins create companies, which get default roles', function (): void {
    $payload = ['code' => 'GAMMA', 'name' => 'Gamma A.Ş.', 'tax_number' => '1234567890'];

    actor($this->adminA)->postJson('/api/v1/companies', $payload, Identity::headers(idempotent: true))->assertStatus(403);

    $id = actor($this->root)->postJson('/api/v1/companies', $payload, Identity::headers(idempotent: true))
        ->assertCreated()->assertJsonPath('data.code', 'GAMMA')->assertJsonPath('data.base_currency', 'TRY')->json('data.id');

    expect(app(CompanyContext::class)->runAs($id, fn () => Role::query()->count()))->toBe(7)
        ->and(Activity::withoutCompanyScope()->where('subject_id', $id)->where('event', 'created')->value('company_id'))->toBe($id);

    actor($this->root)->postJson('/api/v1/companies', $payload, Identity::headers(idempotent: true))->assertStatus(422);
});

it('lists the companies a user belongs to; super admins see all', function (): void {
    expect(actor($this->adminA)->getJson('/api/v1/companies', Identity::headers())->assertOk()->json('data.*.id'))->toBe([$this->a->id])
        ->and(actor($this->root)->getJson('/api/v1/companies?per_page=100', Identity::headers())->json('data.*.id'))->toContain($this->a->id, $this->b->id);
});

it('hides other companies and gates updates by permission in that company', function (): void {
    actor($this->adminA)->getJson("/api/v1/companies/{$this->b->id}", Identity::headers())->assertNotFound();
    actor($this->adminA)->patchJson("/api/v1/companies/{$this->b->id}", ['name' => 'x'], Identity::headers())->assertNotFound();

    actor($this->adminA)->getJson("/api/v1/companies/{$this->a->id}", Identity::headers())->assertOk();
    actor($this->viewerA)->patchJson("/api/v1/companies/{$this->a->id}", ['name' => 'x'], Identity::headers())->assertStatus(403);
    actor($this->adminA)->patchJson("/api/v1/companies/{$this->a->id}", ['name' => 'Alpha Ltd'], Identity::headers())
        ->assertOk()->assertJsonPath('data.name', 'Alpha Ltd');

    $log = Activity::withoutCompanyScope()->where('subject_id', $this->a->id)->where('event', 'updated')->firstOrFail();
    expect($log->attribute_changes?->get('old'))->toBe(['name' => 'Alpha'])
        ->and($log->company_id)->toBe($this->a->id);

    // Admin does not get companies.delete by default.
    actor($this->adminA)->deleteJson("/api/v1/companies/{$this->a->id}", [], Identity::headers())->assertStatus(403);
    actor($this->root)->deleteJson("/api/v1/companies/{$this->b->id}", [], Identity::headers())->assertNoContent();
});

it('manages branches under the active company only', function (): void {
    $h = Identity::headers($this->a);

    $id = actor($this->adminA)->postJson("/api/v1/companies/{$this->a->id}/branches", ['code' => 'IST', 'name' => 'İstanbul'], [...$h, 'Idempotency-Key' => 'b-1'])
        ->assertCreated()->assertJsonPath('data.company_id', $this->a->id)->json('data.id');

    actor($this->adminA)->getJson("/api/v1/companies/{$this->a->id}/branches", $h)->assertOk()->assertJsonCount(1, 'data');
    actor($this->adminA)->patchJson("/api/v1/companies/{$this->a->id}/branches/{$id}", ['name' => 'Istanbul HQ'], $h)->assertOk();

    // Path and header must agree; a branch of another company is never found.
    actor($this->adminA)->getJson("/api/v1/companies/{$this->b->id}/branches", $h)->assertNotFound();
    $foreign = branchIn($this->b);
    actor($this->adminA)->getJson("/api/v1/companies/{$this->a->id}/branches/{$foreign->id}", $h)->assertNotFound();
    actor($this->adminA)->deleteJson("/api/v1/companies/{$this->a->id}/branches/{$foreign->id}", [], $h)->assertNotFound();

    actor($this->viewerA)->postJson("/api/v1/companies/{$this->a->id}/branches", ['code' => 'ANK', 'name' => 'Ankara'], [...$h, 'Idempotency-Key' => 'b-2'])
        ->assertStatus(403);
    actor($this->adminA)->deleteJson("/api/v1/companies/{$this->a->id}/branches/{$id}", [], $h)->assertNoContent();
});

it('manages departments and refuses references into other companies', function (): void {
    $h = Identity::headers($this->a);
    $own = branchIn($this->a);
    $foreign = branchIn($this->b);

    actor($this->adminA)->postJson('/api/v1/departments', ['code' => 'FIN', 'name' => 'Finance', 'branch_id' => $foreign->id], [...$h, 'Idempotency-Key' => 'd-1'])
        ->assertStatus(422)->assertJsonValidationErrors(['branch_id'], 'errors.fields');
    actor($this->adminA)->postJson('/api/v1/departments', ['code' => 'FIN', 'name' => 'Finance', 'manager_user_id' => $this->root->id], [...$h, 'Idempotency-Key' => 'd-2'])
        ->assertStatus(422)->assertJsonValidationErrors(['manager_user_id'], 'errors.fields');
    actor($this->adminA)->postJson('/api/v1/departments', ['code' => 'FIN', 'name' => 'Finance', 'branch_id' => 'not-a-uuid'], [...$h, 'Idempotency-Key' => 'd-3'])
        ->assertStatus(422);

    $id = actor($this->adminA)->postJson('/api/v1/departments', [
        'code' => 'FIN', 'name' => 'Finance', 'branch_id' => $own->id, 'manager_user_id' => $this->viewerA->id,
    ], [...$h, 'Idempotency-Key' => 'd-4'])->assertCreated()->json('data.id');

    actor($this->adminA)->patchJson("/api/v1/departments/{$id}", ['parent_id' => $id], $h)->assertStatus(422);
    actor($this->viewerA)->getJson("/api/v1/departments/{$id}", $h)->assertOk();
    actor($this->viewerA)->patchJson("/api/v1/departments/{$id}", ['name' => 'x'], $h)->assertStatus(403);

    $adminB = Identity::member($this->b, ['Admin']);
    actor($adminB)->getJson("/api/v1/departments/{$id}", Identity::headers($this->b))->assertNotFound();
    actor($adminB)->getJson('/api/v1/departments', Identity::headers($this->b))->assertOk()->assertJsonCount(0, 'data');

    expect(app(CompanyContext::class)->runAs($this->a->id, fn () => Department::query()->count()))->toBe(1);
});

it('requires the company header on company routes', function (): void {
    actor($this->adminA)->getJson('/api/v1/departments', Identity::headers())->assertStatus(400)->assertJsonPath('errors.code', 'COMPANY_REQUIRED');
});
