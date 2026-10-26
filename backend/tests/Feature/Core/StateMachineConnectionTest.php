<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Fixtures\FixtureDocument;
use Tests\Fixtures\FixtureDocumentMachine;

/*
 * Uses a second, committed connection, so no RefreshDatabase; the table is dropped afterwards.
 */
beforeEach(function (): void {
    config(['database.connections.pgsql_docs' => config('database.connections.pgsql')]);
    Schema::connection('pgsql_docs')->dropIfExists('fixture_documents');
    FixtureDocument::createTable('pgsql_docs');
    app(CompanyContext::class)->set((string) Str::uuid7());
});

afterEach(function (): void {
    Schema::connection('pgsql_docs')->dropIfExists('fixture_documents');
    DB::purge('pgsql_docs');
});

it('runs the transition in a transaction on the model connection', function (): void {
    $doc = (new FixtureDocument)->setConnection('pgsql_docs');
    $doc->fill(['name' => 'x'])->save();

    $levels = [];
    $machine = new FixtureDocumentMachine;
    $machine->onBefore = function ($model) use (&$levels): void {
        $levels = [$model->getConnection()->transactionLevel(), DB::connection()->transactionLevel()];
    };

    $machine->transition($doc, 'submitted');

    expect($levels)->toBe([1, 0]);
});
