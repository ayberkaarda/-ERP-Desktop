<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\Account;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->manager = Actors::user(['accounting.accounts.manage']);
    $this->viewer = Actors::user(['accounting.accounts.view']);
});

function importFile(string $name, string $contents): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'acc');
    file_put_contents((string) $path, $contents);

    return new UploadedFile((string) $path, $name, 'text/csv', null, true);
}

it('creates sub-accounts and moves postability down to the leaves', function (): void {
    $sub = Books::postJson($this->manager, $this->company, 'accounts', ['code' => '100.01', 'name' => 'Merkez Kasa', 'parent_code' => '100'])
        ->assertCreated()
        ->assertJsonPath('data.level', 4)
        ->assertJsonPath('data.type', 'asset')
        ->assertJsonPath('data.normal_balance', 'debit')
        ->assertJsonPath('data.tdhp_group', 1)
        ->assertJsonPath('data.is_postable', true)
        ->assertJsonPath('data.is_system', false)
        ->json('data');

    expect(Books::account($this->company, '100')->is_postable)->toBeFalse()
        ->and($sub['parent_id'])->toBe(Books::account($this->company, '100')->id);

    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '100.02', 'name' => 'Şube Kasa', 'parent_id' => $sub['parent_id']])->assertCreated();
    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '200.01', 'name' => 'Wrong prefix', 'parent_code' => '100'])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '100.01', 'name' => 'Duplicate', 'parent_code' => '100'])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    Books::postJson($this->manager, $this->company, 'accounts', ['code' => 'NEWROOT', 'name' => 'No type'])
        ->assertStatus(422)->assertJsonValidationErrors(['type'], 'errors.fields');
    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '9', 'name' => 'Nazım', 'type' => 'memo'])
        ->assertCreated()->assertJsonPath('data.tdhp_group', 9)->assertJsonPath('data.level', 1);
});

it('refuses sub-accounts under an account that already has lines', function (): void {
    Books::post($this->company, '2027-02-02', [['102', '10', '0'], ['600', '0', '10']]);

    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '102.01', 'name' => 'Bank A', 'parent_code' => '102'])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');
    expect(Books::account($this->company, '102')->is_postable)->toBeTrue();
});

it('updates with version locking and the tree and usage rules', function (): void {
    $cash = Books::account($this->company, '100');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$cash->id}", ['name' => 'KASA HESABI', 'version' => 1])
        ->assertOk()->assertJsonPath('data.name', 'KASA HESABI')->assertJsonPath('data.version', 2);
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$cash->id}", ['name' => 'x', 'version' => 1])->assertStatus(409);

    Books::post($this->company, '2027-02-02', [['100', '10', '0'], ['600', '0', '10']]);
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$cash->id}", ['is_postable' => false, 'version' => 2])
        ->assertStatus(422)->assertJsonValidationErrors(['is_postable'], 'errors.fields');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$cash->id}", ['currency_code' => 'USD', 'version' => 2])
        ->assertStatus(422)->assertJsonValidationErrors(['currency_code'], 'errors.fields');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$cash->id}", ['is_active' => false, 'version' => 2])
        ->assertOk()->assertJsonPath('data.is_active', false);

    $group = Books::account($this->company, '10');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$group->id}", ['is_postable' => true, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['is_postable'], 'errors.fields');

    // Moving 10 under its own descendant is a cycle; moving 101 under 12 renames nothing but needs the prefix.
    $sub = Books::postJson($this->manager, $this->company, 'accounts', ['code' => '101.01', 'name' => 'Portföy', 'parent_code' => '101'])->json('data');
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$group->id}", ['parent_id' => Books::account($this->company, '101')->id, 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');

    $root = Books::postJson($this->manager, $this->company, 'accounts', ['code' => 'R', 'name' => 'Root', 'type' => 'asset', 'is_postable' => false])->json('data');
    Books::as(Actors::user(['accounting.accounts.manage', 'settings.update', 'settings.view']), $this->company)
        ->patchJson('/api/v1/settings', ['settings' => ['accounting.account_code_prefix_rule' => false]])->assertOk();
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$sub['id']}", ['parent_id' => $root['id'], 'version' => 1])
        ->assertOk()->assertJsonPath('data.level', 2)->assertJsonPath('data.parent_id', $root['id']);
});

it('deletes only unused, childless, non-system accounts', function (): void {
    $leaf = Books::postJson($this->manager, $this->company, 'accounts', ['code' => '153.01', 'name' => 'Depo A', 'parent_code' => '153'])->json('data');
    $parent = Books::account($this->company, '153');

    Books::as($this->manager, $this->company)->deleteJson("/api/v1/accounts/{$parent->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['account'], 'errors.fields');
    Books::post($this->company, '2027-02-02', [['153.01', '10', '0'], ['600', '0', '10']]);
    Books::as($this->manager, $this->company)->deleteJson("/api/v1/accounts/{$leaf['id']}")
        ->assertStatus(422)->assertJsonValidationErrors(['account'], 'errors.fields');

    $unused = Books::postJson($this->manager, $this->company, 'accounts', ['code' => '153.02', 'name' => 'Depo B', 'parent_code' => '153'])->json('data');
    Books::as($this->manager, $this->company)->deleteJson("/api/v1/accounts/{$unused['id']}?version=2")->assertStatus(409);
    Books::as($this->manager, $this->company)->deleteJson("/api/v1/accounts/{$unused['id']}?version=1")->assertNoContent();
    expect(Books::in($this->company, fn () => Account::query()->whereKey($unused['id'])->exists()))->toBeFalse();
});

it('lists flat with filters and search, and as a tree', function (): void {
    $flat = Books::as($this->viewer, $this->company)->getJson('/api/v1/accounts?filter[postable]=1&filter[type]=liability&per_page=100')
        ->assertOk()->json('data');
    expect(collect($flat)->pluck('code')->all())->toBe(['320', '360', '391']);

    Books::as($this->viewer, $this->company)->getJson('/api/v1/accounts?q=kasa')->assertOk()->assertJsonPath('data.0.code', '100');
    Books::as($this->viewer, $this->company)->getJson('/api/v1/accounts?filter[parent_id]=root&per_page=100')
        ->assertOk()->assertJsonCount(5, 'data');
    Books::as($this->viewer, $this->company)->getJson('/api/v1/accounts?filter[unknown]=1')->assertStatus(422);

    $tree = Books::as($this->viewer, $this->company)->getJson('/api/v1/accounts/tree')->assertOk()->json('data');
    expect(collect($tree)->pluck('code')->all())->toBe(['1', '3', '5', '6', '7'])
        ->and($tree[0]['children'][0]['code'])->toBe('10')
        ->and(collect($tree[0]['children'][0]['children'])->pluck('code')->all())->toBe(['100', '101', '102']);

    // The 7/B accounts of the template are not seeded for a 7/A company.
    expect(collect($tree[4]['children'])->pluck('code')->all())->toBe(['77']);
});

it('reports the booked balance as of a date with the foreign balance', function (): void {
    Books::post($this->company, '2027-02-02', [['100', '100', '0'], ['600', '0', '100']]);
    Books::post($this->company, '2027-05-02', [['100', '0', '30'], ['600', '30', '0']]);
    $cash = Books::account($this->company, '100');

    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$cash->id}/balance?as_of=2027-03-01")
        ->assertOk()->assertJsonPath('data.debit', '100.0000')->assertJsonPath('data.balance', '100.0000')->assertJsonPath('data.balance_side', 'debit');
    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$cash->id}/balance")
        ->assertOk()->assertJsonPath('data.credit', '30.0000')->assertJsonPath('data.balance', '70.0000');
    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$cash->id}/balance?as_of=03.01.2027")->assertStatus(422);

    $sales = Books::account($this->company, '600');
    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$sales->id}/balance")
        ->assertOk()->assertJsonPath('data.balance', '-70.0000')->assertJsonPath('data.balance_side', 'credit');
});

it('imports a CSV chart with a dry run, an error report and an all-or-nothing commit', function (): void {
    $csv = "code;name;parent_code;type;requires_party;currency_code\n120.01;Yurt içi alıcılar;120;;evet;\n120.01.001;Bayi A;120.01;;;\n102.01;USD hesabı;102;;;USD\n";

    $dry = Books::as($this->manager, $this->company)->post('/api/v1/accounts/import', ['file' => importFile('chart.csv', $csv), 'dry_run' => 1], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertOk()->json('data');
    expect($dry)->toMatchArray(['dry_run' => true, 'total' => 3, 'created' => 0, 'errors' => []])
        ->and(Books::in($this->company, fn () => Account::query()->where('code', '120.01')->exists()))->toBeFalse();

    $bad = "code,name,parent_code,type\n120.01,Ok,120,\n999.01,No parent,999,\n100,Existing,,asset\n";
    Books::as($this->manager, $this->company)->post('/api/v1/accounts/import', ['file' => importFile('bad.csv', $bad)], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['rows.3.parent_id', 'rows.4.code'], 'errors.fields');
    expect(Books::in($this->company, fn () => Account::query()->where('code', '120.01')->exists()))->toBeFalse();

    Books::as($this->manager, $this->company)->post('/api/v1/accounts/import', ['file' => importFile('chart.csv', $csv)], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertOk()->assertJsonPath('data.created', 3);

    $bayi = Books::account($this->company, '120.01.001');
    expect($bayi->level)->toBe(5)->and($bayi->requires_party)->toBeFalse()
        ->and(Books::account($this->company, '120.01')->requires_party)->toBeTrue()
        ->and(Books::account($this->company, '120.01')->is_postable)->toBeFalse()
        ->and(Books::account($this->company, '102.01')->currency_code)->toBe('USD');
});

it('imports XLSX files and rejects files without a header', function (): void {
    $sheet = new Spreadsheet;
    $sheet->getActiveSheet()->fromArray([['code', 'name', 'parent_code'], ['600.01', 'Mal satışları', '600'], ['600.02', 'Hizmet satışları', '600']]);
    $path = tempnam(sys_get_temp_dir(), 'acc').'.xlsx';
    (new Xlsx($sheet))->save($path);
    $file = new UploadedFile($path, 'chart.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

    Books::as($this->manager, $this->company)->post('/api/v1/accounts/import', ['file' => $file, 'dry_run' => 0], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertOk()->assertJsonPath('data.created', 2);
    expect(Books::account($this->company, '600.02')->type->value)->toBe('revenue');

    Books::as($this->manager, $this->company)->post('/api/v1/accounts/import', ['file' => importFile('x.csv', "foo,bar\n1,2\n")], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertStatus(422)->assertJsonValidationErrors(['file'], 'errors.fields');
    Books::as($this->viewer, $this->company)->post('/api/v1/accounts/import', ['file' => importFile('x.csv', "code,name\n")], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertForbidden();
});

it('keeps accounts of other companies invisible', function (): void {
    $other = Books::company();
    $foreign = Books::account($other, '100');

    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$foreign->id}")->assertNotFound();
    Books::as($this->viewer, $this->company)->getJson("/api/v1/accounts/{$foreign->id}/balance")->assertNotFound();
    Books::as($this->manager, $this->company)->patchJson("/api/v1/accounts/{$foreign->id}", ['name' => 'x', 'version' => 1])->assertNotFound();
    Books::as($this->manager, $this->company)->deleteJson("/api/v1/accounts/{$foreign->id}")->assertNotFound();
    Books::postJson($this->manager, $this->company, 'accounts', ['code' => '100.09', 'name' => 'x', 'parent_id' => $foreign->id])
        ->assertStatus(422)->assertJsonValidationErrors(['parent_id'], 'errors.fields');
});
