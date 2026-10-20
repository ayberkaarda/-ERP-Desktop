<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\Fixtures\FixtureDocument;
use Tests\Fixtures\FixtureDocumentResource;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    FixtureDocument::createTable();
    $context = app(CompanyContext::class);

    $context->runAs((string) Str::uuid7(), fn () => FixtureDocument::create(['name' => 'Other company Alpha']));
    $context->set((string) Str::uuid7());

    foreach ([['Alpha Ltd', 'draft', '10'], ['Beta AŞ', 'posted', '30'], ['Gamma 100%', 'draft', '20'], ['alphabet', 'cancelled', '5']] as [$name, $status, $total]) {
        FixtureDocument::create(['name' => $name, 'status' => $status, 'total' => $total]);
    }

    Route::get('/api/v1/_probe/docs', fn (Request $request) => ApiResponse::paginated(
        ListQuery::for(FixtureDocument::query(), $request, ['name', 'amount' => 'total'], ['status'], ['name']),
        FixtureDocumentResource::class,
    ));
});

it('paginates in the shared envelope, scoped to the company', function (): void {
    $this->getJson('/api/v1/_probe/docs?per_page=3&page=2&sort=name')
        ->assertOk()
        ->assertJsonPath('meta.pagination', ['current_page' => 2, 'per_page' => 3, 'total' => 4, 'last_page' => 2])
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'Gamma 100%');
});

it('sorts by allowed columns and aliases', function (): void {
    $this->getJson('/api/v1/_probe/docs?sort=-amount')
        ->assertOk()
        ->assertJsonPath('data.*.total', ['30.0000', '20.0000', '10.0000', '5.0000']);
});

it('filters by exact and multiple values', function (): void {
    $this->getJson('/api/v1/_probe/docs?filter[status]=draft&sort=name')
        ->assertJsonPath('data.*.name', ['Alpha Ltd', 'Gamma 100%']);

    $this->getJson('/api/v1/_probe/docs?filter[status]=posted,cancelled&sort=-amount')
        ->assertJsonPath('data.*.name', ['Beta AŞ', 'alphabet']);
});

it('searches case-insensitively and treats wildcards literally', function (): void {
    $this->getJson('/api/v1/_probe/docs?q=ALPHA&sort=amount')
        ->assertJsonPath('data.*.name', ['alphabet', 'Alpha Ltd']);

    $this->getJson('/api/v1/_probe/docs?q=%25')
        ->assertJsonPath('data.*.name', ['Gamma 100%']);
});

it('rejects unknown sorts and filters and oversize pages', function (string $query, string $field): void {
    $this->getJson("/api/v1/_probe/docs?{$query}")
        ->assertStatus(422)
        ->assertJsonPath('errors.code', 'VALIDATION_ERROR')
        ->assertJsonStructure(['errors' => ['fields' => [$field]]]);
})->with([
    ['sort=company_id', 'sort'],
    ['filter[company_id]=x', 'filter.company_id'],
    ['per_page=101', 'per_page'],
    ['page=0', 'page'],
]);

it('has pg_trgm and pgcrypto installed', function (): void {
    $extensions = DB::table('pg_extension')->pluck('extname')->all();

    expect($extensions)->toContain('pg_trgm')->toContain('pgcrypto')
        ->and(DB::selectOne("select similarity('alpha', 'alpah') > 0 as ok")?->ok)->toBeTrue();
});
