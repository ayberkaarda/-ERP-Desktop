<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The skeleton users table uses bigint keys; every key in the system is a UUIDv7.
        DB::statement('ALTER TABLE users ALTER COLUMN id DROP DEFAULT');
        DB::statement('ALTER TABLE users ALTER COLUMN id TYPE uuid USING uuidv7()');
        DB::statement('ALTER TABLE users ALTER COLUMN id SET DEFAULT uuidv7()');
        DB::statement('DROP SEQUENCE IF EXISTS users_id_seq');

        Schema::table('users', function (Blueprint $table): void {
            $table->string('locale', 5)->default('tr');
            $table->boolean('is_super_admin')->default(false);
            $table->boolean('is_active')->default(true);
            $table->boolean('must_change_password')->default(false);
            $table->timestampTz('deactivated_at')->nullable();
            $table->timestampTz('password_changed_at')->nullable();
            $table->timestampTz('last_login_at')->nullable();
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            $table->timestampTz('two_factor_confirmed_at')->nullable();
            $table->unsignedBigInteger('two_factor_last_timestep')->nullable();
            $table->softDeletesTz();
        });

        // Session rows are ephemeral; their user key must follow the users key type.
        DB::table('sessions')->delete();
        DB::statement('ALTER TABLE sessions ALTER COLUMN user_id TYPE uuid USING NULL');
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn([
                'locale', 'is_super_admin', 'is_active', 'must_change_password', 'deactivated_at',
                'password_changed_at', 'last_login_at', 'two_factor_secret', 'two_factor_recovery_codes',
                'two_factor_confirmed_at', 'two_factor_last_timestep', 'deleted_at',
            ]);
        });
        // Key type changes are not reverted: uuid values cannot map back to the old sequence.
    }
};
