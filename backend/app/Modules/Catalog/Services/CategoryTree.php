<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemCategory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Category tree on parent_id plus a materialized path ("/root/.../self/") and depth.
 * Writes that change the shape take a per-company advisory lock, so two concurrent moves can
 * never build a cycle between them.
 */
final class CategoryTree
{
    public const int MAX_DEPTH = 8;

    public const array INDEXES = ['item_categories_company_code_unique' => 'code'];

    /**
     * @param  array<string, mixed>  $data  code, name, is_active?, parent_id?
     */
    public function create(array $data): ItemCategory
    {
        return CatalogRules::transaction(function () use ($data): ItemCategory {
            CatalogRules::lock('item_categories');
            $parent = $this->parent($data['parent_id'] ?? null);

            $category = new ItemCategory(collect($data)->only(['code', 'name', 'is_active'])->all());
            $category->id = (string) Str::uuid7();
            $category->parent_id = $parent?->id;
            $category->depth = ($parent === null ? 0 : $parent->depth) + 1;
            $category->path = ($parent === null ? '/' : $parent->path).$category->id.'/';

            if ($category->depth > self::MAX_DEPTH) {
                CatalogRules::fail('parent_id', 'category_depth', ['max' => self::MAX_DEPTH]);
            }

            $category->save();

            return $category;
        }, self::INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data  code?, name?, is_active?, parent_id?
     */
    public function update(ItemCategory $category, array $data, int $version): ItemCategory
    {
        return CatalogRules::transaction(function () use ($category, $data, $version): ItemCategory {
            CatalogRules::lock('item_categories');
            $locked = ItemCategory::query()->whereKey($category->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);
            $locked->fill(collect($data)->only(['code', 'name', 'is_active'])->all());

            if (array_key_exists('parent_id', $data) && $data['parent_id'] !== $locked->parent_id) {
                $this->move($locked, $this->parent($data['parent_id']));
            }

            $locked->save();

            return $locked;
        }, self::INDEXES);
    }

    public function delete(ItemCategory $category, ?int $version = null): void
    {
        DB::transaction(function () use ($category, $version): void {
            CatalogRules::lock('item_categories');
            $category = CatalogRules::lockVersion($category, $version);

            if (ItemCategory::query()->where('parent_id', $category->id)->exists()) {
                CatalogRules::fail('category', 'category_has_children');
            }

            if (Item::query()->where('category_id', $category->id)->exists()
                || DiscountRule::query()->where('scope', 'category')->where('scope_ref', $category->id)->exists()) {
                CatalogRules::fail('category', 'category_in_use');
            }

            $category->delete();
        });
    }

    /**
     * Ids of the category and all its descendants, as a subquery.
     *
     * @return Builder<ItemCategory>
     */
    public static function subtree(string $categoryId): Builder
    {
        $path = Str::isUuid($categoryId) ? ItemCategory::query()->whereKey($categoryId)->value('path') : null;
        $query = ItemCategory::query()->select('id');

        return is_string($path)
            ? $query->where('path', 'like', addcslashes($path, '%_\\').'%')
            : $query->whereRaw('false');
    }

    private function move(ItemCategory $category, ?ItemCategory $parent): void
    {
        if ($parent !== null && str_starts_with($parent->path, $category->path)) {
            CatalogRules::fail('parent_id', 'category_cycle');
        }

        $oldPath = $category->path;
        $newDepth = ($parent === null ? 0 : $parent->depth) + 1;
        $delta = $newDepth - $category->depth;
        $like = addcslashes($oldPath, '%_\\').'%';
        $deepest = ItemCategory::query()->where('path', 'like', $like)->max('depth');

        if ((is_numeric($deepest) ? (int) $deepest : $category->depth) + $delta > self::MAX_DEPTH) {
            CatalogRules::fail('parent_id', 'category_depth', ['max' => self::MAX_DEPTH]);
        }

        $newPath = ($parent === null ? '/' : $parent->path).$category->id.'/';

        // Descendants keep their own suffix; soft-deleted ones move too so paths stay consistent.
        DB::update(
            'update item_categories set path = ? || substr(path, ?), depth = depth + ?, version = version + 1, updated_at = now() where company_id = ? and path like ? and id <> ?',
            [$newPath, strlen($oldPath) + 1, $delta, $category->company_id, $like, $category->id],
        );

        $category->parent_id = $parent?->id;
        $category->path = $newPath;
        $category->depth = $newDepth;
    }

    private function parent(mixed $id): ?ItemCategory
    {
        if ($id === null) {
            return null;
        }

        $parent = is_string($id) ? ItemCategory::query()->find($id) : null;

        return $parent ?? CatalogRules::fail('parent_id', 'category_parent_missing');
    }
}
