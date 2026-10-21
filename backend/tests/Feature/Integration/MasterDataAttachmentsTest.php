<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Files\Models\File;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Models\Project;
use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

const ATTACHMENT_PNG = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82";

beforeEach(function (): void {
    Storage::fake('local');
    $this->other = Actors::company();
    $this->company = Actors::company();
    $this->user = Actors::user(['files.view', 'files.create']);
});

/**
 * One record of each attachable master data type in the company, keyed by its morph alias.
 *
 * @return array<string, Model>
 */
function attachables(string $company): array
{
    $unit = Catalog::unit($company, 'PCS');
    $list = Catalog::priceList($company);

    return app(CompanyContext::class)->runAs($company, fn (): array => [
        'party' => Party::factory()->create(),
        'item' => Item::factory()->create(['base_unit_id' => $unit->id]),
        'price_list' => $list,
        'reference_projects' => Project::factory()->create(),
        'reference_warehouses' => Warehouse::factory()->create(),
    ]);
}

/** @return TestResponse<\Symfony\Component\HttpFoundation\Response> */
function attach(mixed $user, string $company, string $type, string $id): TestResponse
{
    Identity::fresh();

    return test()->actingAs($user, 'web')->withHeaders(['X-Company-Id' => $company, 'Accept' => 'application/json', 'Idempotency-Key' => (string) Str::uuid7()])
        ->post('/api/v1/files', ['file' => UploadedFile::fake()->createWithContent('scan.png', ATTACHMENT_PNG), 'attachable_type' => $type, 'attachable_id' => $id]);
}

it('accepts uploads for parties, items, price lists, projects and warehouses by morph alias', function (): void {
    foreach (attachables($this->company) as $alias => $record) {
        expect($record->getMorphClass())->toBe($alias);
        attach($this->user, $this->company, $alias, (string) $record->getKey())->assertCreated()
            ->assertJsonPath('data.attachable_type', $alias)->assertJsonPath('data.attachable_id', $record->getKey());

        Identity::fresh();
        test()->actingAs($this->user, 'web')->withHeaders(['X-Company-Id' => $this->company, 'Accept' => 'application/json'])
            ->getJson("/api/v1/files?filter[attachable_type]={$alias}&filter[attachable_id]={$record->getKey()}")
            ->assertOk()->assertJsonCount(1, 'data');
    }
});

it('refuses another company\'s records and unknown ids', function (): void {
    foreach (attachables($this->other) as $alias => $record) {
        attach($this->user, $this->company, $alias, (string) $record->getKey())->assertStatus(422)->assertJsonValidationErrors(['attachable_id'], 'errors.fields');
        attach($this->user, $this->company, $alias, (string) Str::uuid7())->assertStatus(422);
    }
    expect(File::query()->withoutCompanyScope()->count())->toBe(0);
});
