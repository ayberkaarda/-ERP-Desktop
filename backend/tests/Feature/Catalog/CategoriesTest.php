<?php

declare(strict_types=1);

use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Services\CategoryTree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->admin = Actors::user(['item_categories.manage']);
    $this->viewer = Actors::user(['items.view']);
    $this->other = Actors::company();
});

function categoryRow(string $company, string $id): ItemCategory
{
    return Catalog::in($company, fn (): ItemCategory => ItemCategory::query()->findOrFail($id));
}

it('creates roots and children with materialized path and depth', function (): void {
    $root = Catalog::post($this->admin, $this->company, 'item-categories', ['code' => 'FOOD', 'name' => 'Food'])
        ->assertCreated()->assertJsonPath('data.depth', 1)->assertJsonPath('data.parent_id', null)->json('data');
    $child = Catalog::post($this->admin, $this->company, 'item-categories', ['code' => 'DAIRY', 'name' => 'Dairy', 'parent_id' => $root['id']])
        ->assertCreated()->assertJsonPath('data.depth', 2)->json('data');

    expect($child['path_ids'])->toBe([$root['id'], $child['id']])
        ->and(categoryRow($this->company, $child['id'])->path)->toBe("/{$root['id']}/{$child['id']}/");

    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/item-categories?filter[parent_id]=root')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.code', 'FOOD');
    Catalog::post($this->viewer, $this->company, 'item-categories', ['code' => 'X', 'name' => 'X'])->assertStatus(403);
});

it('moves a subtree and rewrites descendant paths and depths', function (): void {
    $a = Catalog::category($this->company, 'A');
    $b = Catalog::category($this->company, 'B');
    $a1 = Catalog::category($this->company, 'A1', $a);
    $a11 = Catalog::category($this->company, 'A11', $a1);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$a1->id}", ['parent_id' => $b->id, 'version' => 1])
        ->assertOk()->assertJsonPath('data.depth', 2)->assertJsonPath('data.parent_id', $b->id);

    $moved = categoryRow($this->company, $a11->id);
    expect($moved->path)->toBe("/{$b->id}/{$a1->id}/{$a11->id}/")
        ->and($moved->depth)->toBe(3)
        ->and($moved->parent_id)->toBe($a1->id);

    // Back to the top level.
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$a1->id}", ['parent_id' => null, 'version' => 2])
        ->assertOk()->assertJsonPath('data.depth', 1);
    expect(categoryRow($this->company, $a11->id)->path)->toBe("/{$a1->id}/{$a11->id}/")
        ->and(categoryRow($this->company, $a11->id)->depth)->toBe(2);

    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/item-categories?filter[subtree]={$a1->id}&sort=path")
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.id', $a1->id);
});

it('prevents cycles', function (): void {
    $a = Catalog::category($this->company, 'A');
    $b = Catalog::category($this->company, 'B', $a);
    $c = Catalog::category($this->company, 'C', $b);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$a->id}", ['parent_id' => $c->id, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$a->id}", ['parent_id' => $a->id, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');

    expect(categoryRow($this->company, $a->id)->parent_id)->toBeNull();
});

it('caps the depth on create and on move', function (): void {
    $parent = null;
    $chain = [];

    for ($i = 1; $i <= CategoryTree::MAX_DEPTH; $i++) {
        $parent = $chain[] = Catalog::category($this->company, "L{$i}", $parent);
    }

    expect($parent?->depth)->toBe(CategoryTree::MAX_DEPTH);
    Catalog::post($this->admin, $this->company, 'item-categories', ['code' => 'TOO-DEEP', 'name' => 'x', 'parent_id' => $parent?->id])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');

    // A two-level subtree fits under level 6 but not under level 7.
    $x = Catalog::category($this->company, 'X');
    Catalog::category($this->company, 'X1', $x);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$x->id}", ['parent_id' => $chain[6]->id, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$x->id}", ['parent_id' => $chain[5]->id, 'version' => 1])
        ->assertOk()->assertJsonPath('data.depth', 7);
});

it('refuses parents from another company and deleting used categories', function (): void {
    $foreign = Catalog::category($this->other, 'FOREIGN');

    Catalog::post($this->admin, $this->company, 'item-categories', ['code' => 'MINE', 'name' => 'Mine', 'parent_id' => $foreign->id])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->getJson("/api/v1/item-categories/{$foreign->id}")->assertNotFound();

    $root = Catalog::category($this->company, 'ROOT');
    $leaf = Catalog::category($this->company, 'LEAF', $root);
    $unit = Catalog::unit($this->company, 'PCS');
    Catalog::item($this->company, $unit, ['category_id' => $leaf->id]);

    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/item-categories/{$root->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['category'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/item-categories/{$leaf->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['category'], 'errors.fields');

    $empty = Catalog::category($this->company, 'EMPTY');
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/item-categories/{$empty->id}")->assertNoContent();
});
