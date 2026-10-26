<?php

declare(strict_types=1);

namespace App\Modules\Identity\Database\seeders;

use App\Models\User;
use App\Modules\Identity\Rules\StrongPassword;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Validator;
use RuntimeException;

/**
 * First super admin from ADMIN_EMAIL / ADMIN_PASSWORD. There is no default credential:
 * missing or weak values abort the seed. An existing account is left untouched.
 */
class SuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        $email = self::env('ADMIN_EMAIL');
        $password = self::env('ADMIN_PASSWORD');
        $name = self::env('ADMIN_NAME', required: false) ?? 'Administrator';

        $validator = Validator::make(
            ['email' => $email, 'password' => $password],
            ['email' => ['required', 'email', 'max:254'], 'password' => ['required', new StrongPassword($email, $name)]],
        );

        if ($validator->fails()) {
            throw new RuntimeException('Invalid ADMIN_EMAIL / ADMIN_PASSWORD: '.implode(' ', $validator->errors()->all()));
        }

        if (User::withTrashed()->where('email', mb_strtolower((string) $email))->exists()) {
            $this->command?->info('Super admin already exists; nothing changed.');

            return;
        }

        $user = new User(['name' => $name, 'email' => (string) $email, 'password' => (string) $password, 'locale' => 'tr']);
        $user->forceFill(['is_super_admin' => true, 'email_verified_at' => now()])->save();

        $this->command?->info("Super admin {$user->email} created.");
    }

    private static function env(string $key, bool $required = true): ?string
    {
        $value = getenv($key);
        $value = $value === false ? ($_ENV[$key] ?? $_SERVER[$key] ?? null) : $value;

        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }

        if ($required) {
            throw new RuntimeException("{$key} must be set to seed the first super admin.");
        }

        return null;
    }
}
