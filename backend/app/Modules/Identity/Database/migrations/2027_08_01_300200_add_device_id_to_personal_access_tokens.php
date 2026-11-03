<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table): void {
            // The desktop device a token was minted for. Unlike user_devices.token_id it does not
            // change on refresh, so a sign-out by a just-rotated token still finds its device.
            $table->uuid('device_id')->nullable()->index();
            $table->foreign('device_id')->references('id')->on('user_devices')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table): void {
            $table->dropForeign(['device_id']);
            $table->dropColumn('device_id');
        });
    }
};
