<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

it('reports ok on the health endpoint', function (): void {
    $this->getJson('/api/v1/health')
        ->assertOk()
        ->assertExactJson(['data' => ['status' => 'ok']]);
});

it('runs against the postgres test database', function (): void {
    $row = DB::selectOne('select current_database() as name, version() as version');

    expect(DB::connection()->getDriverName())->toBe('pgsql')
        ->and($row->name)->toBe('keystone_test')
        ->and($row->version)->toStartWith('PostgreSQL 18');
});
