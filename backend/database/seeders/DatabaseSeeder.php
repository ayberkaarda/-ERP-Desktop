<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Modules\Identity\Database\seeders\IdentitySeeder;
use App\Modules\Identity\Database\seeders\SuperAdminSeeder;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * No demo users or default passwords: the first account comes from ADMIN_EMAIL / ADMIN_PASSWORD.
     * Every seeder here is idempotent (safe to re-run): ReferenceSeeder only adds the missing global
     * currencies and tax codes and never changes existing rows. Per-company defaults (company
     * currencies, payment terms, warehouse, units, cost center) are not seeded here; they are created
     * when a company is created (CompanyCreated listeners).
     */
    public function run(): void
    {
        $this->call([IdentitySeeder::class, ReferenceSeeder::class, SuperAdminSeeder::class]);
    }
}
