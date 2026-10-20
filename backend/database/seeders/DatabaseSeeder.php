<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Modules\Identity\Database\seeders\IdentitySeeder;
use App\Modules\Identity\Database\seeders\SuperAdminSeeder;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * No demo users or default passwords: the first account comes from ADMIN_EMAIL / ADMIN_PASSWORD.
     */
    public function run(): void
    {
        $this->call([IdentitySeeder::class, SuperAdminSeeder::class]);
    }
}
