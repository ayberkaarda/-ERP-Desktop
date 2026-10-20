<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Minimal companies rows for tests that only need a valid company_id (company foreign keys).
 */
final class Companies
{
    public static function make(?ConnectionInterface $db = null): string
    {
        $id = (string) Str::uuid7();

        ($db ?? DB::connection())->table('companies')->insert([
            'id' => $id,
            'code' => 'T'.Str::upper(Str::random(12)),
            'name' => 'Test company '.$id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    /**
     * For tests that commit outside RefreshDatabase.
     */
    public static function remove(string $id, ?ConnectionInterface $db = null): void
    {
        ($db ?? DB::connection())->table('companies')->where('id', $id)->delete();
    }
}
