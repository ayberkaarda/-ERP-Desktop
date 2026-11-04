<?php

declare(strict_types=1);

// Demo data for the desktop e2e suite, on top of `php artisan migrate --seed`
// (identity, reference and the super admin from ADMIN_EMAIL / ADMIN_PASSWORD).
// Writes the ids and a super-admin API token the specs need to E2E_STATE.
//
//   E2E_BACKEND_DIR=backend E2E_STATE=/tmp/state.json php desktop/e2e/seed/seed.php

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Identity\Services\UserAdministration;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Organization\Models\Company;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Models\Warehouse;

$backend = getenv('E2E_BACKEND_DIR') ?: dirname(__DIR__, 3).'/backend';
$statePath = getenv('E2E_STATE') ?: dirname(__DIR__).'/state.json';
$password = 'correct-horse-battery-staple';

require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

app(PermissionCatalog::class)->sync();

$company = Company::factory()->create(['name' => 'E2E Company']);
CompanyCreated::dispatch($company->id, null, true);

$member = static function (string $email, string $name, array $roles) use ($company, $password): User {
    $user = User::factory()->create(['email' => $email, 'name' => $name, 'password' => $password]);
    app(CompanyDirectory::class)->setMembership($user->id, $company->id, true);
    app(UserAdministration::class)->syncRoles(null, $user, $company->id, $roles);

    return $user;
};

$operator = $member('e2e.operator@example.test', 'E2E Operator', ['Admin']);
$leaver = $member('e2e.leaver@example.test', 'E2E Leaver', ['Admin']);

// The web side of the scenarios: the super admin of the seeder, with an API token.
$root = User::query()->where('email', mb_strtolower((string) getenv('ADMIN_EMAIL')))->firstOrFail();
app(CompanyDirectory::class)->setMembership($root->id, $company->id, true);
$token = $root->createToken('e2e-web', ['*'])->plainTextToken;

$records = app(CompanyContext::class)->runAs($company->id, static function (): array {
    $party = Party::factory()->create(['name' => 'E2E Customer']);
    $unit = Unit::factory()->create(['code' => 'E2EPCS', 'name' => 'E2E piece']);
    $item = Item::factory()->create(['base_unit_id' => $unit->id, 'code' => 'E2E-WIDGET', 'name' => 'E2E widget']);
    $warehouse = Warehouse::query()->where('is_default', true)->first()
        ?? Warehouse::factory()->create(['code' => 'E2E', 'name' => 'E2E', 'negative_stock_policy' => 'block', 'is_default' => true]);

    return ['party' => $party, 'item' => $item, 'warehouse' => $warehouse];
});

file_put_contents($statePath, json_encode([
    'company_id' => $company->id,
    'password' => $password,
    'operator' => ['id' => $operator->id, 'email' => $operator->email],
    'leaver' => ['id' => $leaver->id, 'email' => $leaver->email],
    'root_token' => $token,
    'party' => ['id' => $records['party']->id, 'name' => 'E2E Customer'],
    'item_id' => $records['item']->id,
    'warehouse_id' => $records['warehouse']->id,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

echo "seeded company {$company->id}\n";
