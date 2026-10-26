<?php

declare(strict_types=1);

use App\Core\Company\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\Fixtures\FixtureDocument;

uses(RefreshDatabase::class);

/**
 * Tables that carry company_id but are deliberately not scoped (e.g. spatie pivots). Keep tiny.
 *
 * @var list<class-string<Model>>
 */
const COMPANY_SCOPE_EXEMPT = [];

/**
 * @return list<class-string<Model>>
 */
function appModels(): array
{
    $root = dirname(__DIR__, 3).'/app';
    $models = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));

    foreach ($files as $file) {
        if (! $file instanceof SplFileInfo || $file->getExtension() !== 'php') {
            continue;
        }

        $relative = substr($file->getPathname(), strlen($root) + 1, -4);
        $class = 'App\\'.str_replace(['/', '\\'], '\\', $relative);

        if (class_exists($class) && is_subclass_of($class, Model::class) && ! (new ReflectionClass($class))->isAbstract()) {
            $models[] = $class;
        }
    }

    return $models;
}

/**
 * @param  list<class-string<Model>>  $models
 * @return list<string>
 */
function unscopedCompanyModels(array $models): array
{
    $violations = [];

    foreach ($models as $class) {
        $table = (new $class)->getTable();

        if (in_array($class, COMPANY_SCOPE_EXEMPT, true) || ! Schema::hasTable($table) || ! Schema::hasColumn($table, 'company_id')) {
            continue;
        }

        if (! in_array(BelongsToCompany::class, class_uses_recursive($class), true)) {
            $violations[] = $class;
        }
    }

    return $violations;
}

it('scopes every model whose table has company_id', function (): void {
    expect(unscopedCompanyModels(appModels()))->toBe([]);
});

it('detects an unscoped company model', function (): void {
    FixtureDocument::createTable();
    $unscoped = new class extends Model
    {
        protected $table = 'fixture_documents';
    };

    expect(unscopedCompanyModels([FixtureDocument::class]))->toBe([])
        ->and(unscopedCompanyModels([$unscoped::class]))->toBe([$unscoped::class]);
});
