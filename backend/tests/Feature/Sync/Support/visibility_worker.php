<?php

declare(strict_types=1);

/*
 * Test-only child process for VisibilityGenerationTest: in one transaction, takes fixtures.view
 * away from a role through RoleAdministration (so AccessChanged runs), writes the marker file,
 * keeps the transaction open for a moment and commits. Usage: <company> <role> <admin> <marker>.
 */

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\RoleAdministration;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\TestCase;

require __DIR__.'/../../../../vendor/autoload.php';

$app = require __DIR__.'/../../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

[, $company, $roleId, $adminId, $marker] = $argv;
SyncKit::boot();

DB::transaction(static function () use ($app, $company, $roleId, $adminId, $marker): void {
    $app->make(CompanyContext::class)->runAs($company, static function () use ($app, $roleId, $adminId): void {
        $app->make(RoleAdministration::class)->update(User::query()->findOrFail($adminId), Role::query()->findOrFail($roleId), ['permissions' => ['fixtures.create']]);
    });
    file_put_contents($marker, 'changed');
    // The parent changes its role now, while this transaction is still open.
    usleep(3_000_000);
});

echo json_encode(['outcome' => 'ok'], JSON_THROW_ON_ERROR);
