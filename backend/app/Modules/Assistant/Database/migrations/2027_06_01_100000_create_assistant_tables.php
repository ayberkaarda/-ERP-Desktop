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
        Schema::create('assistant_conversations', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies')->restrictOnDelete();
            $t->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $t->string('title', 200);
            $t->integer('version')->default(1);
            $t->uuid('lease_token')->nullable();
            $t->timestampTz('busy_until')->nullable();
            $t->timestampsTz();
            $t->index(['company_id', 'user_id', 'updated_at']);
            $t->unique(['id', 'company_id', 'user_id']);
        });
        Schema::create('assistant_messages', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $t->uuid('company_id')->index();
            $t->uuid('user_id')->index();
            $t->uuid('request_id');
            $t->string('role', 20);
            $t->string('status', 30);
            $t->text('content');
            $t->jsonb('context')->default('[]');
            $t->text('sdk_messages');
            $t->uuid('usage_id')->nullable();
            $t->bigInteger('reserved_tokens')->default(0);
            $t->boolean('reservation_settled')->default(true);
            $t->timestampsTz();
            $t->unique(['conversation_id', 'request_id', 'role']);
            $t->unique(['id', 'conversation_id', 'company_id', 'user_id']);
            $t->foreign(['conversation_id', 'company_id', 'user_id'])->references(['id', 'company_id', 'user_id'])->on('assistant_conversations')->cascadeOnDelete();
        });
        Schema::create('assistant_tool_calls', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('message_id')->constrained('assistant_messages')->cascadeOnDelete();
            $t->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $t->uuid('company_id')->index();
            $t->uuid('user_id')->index();
            $t->string('provider_call_id', 255);
            $t->string('tool', 150);
            $t->string('kind', 10);
            $t->string('status', 20);
            $t->text('reason')->nullable();
            $t->text('arguments');
            $t->jsonb('preview');
            $t->jsonb('result')->nullable();
            $t->timestampTz('resolved_at')->nullable();
            $t->timestampsTz();
            $t->unique(['message_id', 'provider_call_id']);
            $t->foreign(['message_id', 'conversation_id', 'company_id', 'user_id'])->references(['id', 'conversation_id', 'company_id', 'user_id'])->on('assistant_messages')->cascadeOnDelete();
        });
        Schema::create('assistant_usage', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies')->restrictOnDelete();
            $t->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $t->date('date');
            $t->bigInteger('input_tokens')->default(0);
            $t->bigInteger('output_tokens')->default(0);
            $t->bigInteger('reserved_tokens')->default(0);
            $t->integer('requests')->default(0);
            $t->integer('failures')->default(0);
            $t->timestampsTz();
            $t->unique(['company_id', 'user_id', 'date']);
            $t->unique(['id', 'company_id', 'user_id']);
        });
        Schema::table('assistant_messages', function (Blueprint $t): void {
            $t->foreign(['usage_id', 'company_id', 'user_id'], 'assistant_message_usage_owner_fk')->references(['id', 'company_id', 'user_id'])->on('assistant_usage')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE assistant_usage ADD CONSTRAINT assistant_usage_nonnegative CHECK (input_tokens >= 0 AND output_tokens >= 0 AND reserved_tokens >= 0 AND requests >= 0 AND failures >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('assistant_tool_calls');
        Schema::dropIfExists('assistant_messages');
        Schema::dropIfExists('assistant_usage');
        Schema::dropIfExists('assistant_conversations');
    }
};
