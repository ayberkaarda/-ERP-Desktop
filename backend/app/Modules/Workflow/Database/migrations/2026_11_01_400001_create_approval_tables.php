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
        Schema::create('approval_flows', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->string('document_type', 100);
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->boolean('allow_self_approval')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->softDeletesTz();
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX approval_flows_active_type_unique ON approval_flows (company_id, document_type) WHERE is_active = true AND deleted_at IS NULL');
        Schema::create('approval_flow_steps', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('flow_id')->constrained('approval_flows')->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->string('mode', 10);
            $table->string('approver_type', 10);
            $table->string('approver_ref');
            $table->decimal('min_amount', 20, 4)->nullable();
            $table->decimal('max_amount', 20, 4)->nullable();
            $table->timestampsTz();
            $table->unique(['flow_id', 'position']);
        });
        Schema::create('approval_requests', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('flow_id')->nullable()->constrained('approval_flows')->restrictOnDelete();
            $table->string('document_type', 100);
            $table->uuid('document_id');
            $table->string('status', 12)->default('pending');
            $table->unsignedInteger('current_step')->nullable();
            $table->decimal('amount', 20, 4)->nullable();
            $table->uuid('requested_by');
            $table->boolean('allow_self_approval')->default(false);
            $table->jsonb('steps');
            $table->string('revision', 100)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestampsTz();
            $table->index(['company_id', 'status']);
        });
        DB::statement("CREATE UNIQUE INDEX approval_requests_pending_document_unique ON approval_requests (company_id, document_type, document_id) WHERE status = 'pending'");
        Schema::create('approval_request_approvers', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id');
            $table->foreignUuid('request_id')->constrained('approval_requests')->cascadeOnDelete();
            $table->unsignedInteger('step_position');
            $table->string('approver_type', 10)->default('user');
            $table->string('approver_ref');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['request_id', 'step_position', 'approver_type', 'approver_ref'], 'approval_request_approvers_unique');
            $table->index(['company_id', 'approver_type', 'approver_ref', 'request_id'], 'approval_request_approvers_lookup');
        });
        Schema::create('approval_decisions', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->foreignUuid('request_id')->constrained('approval_requests')->restrictOnDelete();
            $table->unsignedInteger('step_position');
            $table->uuid('actor_id');
            $table->string('decision', 7);
            $table->text('comment')->nullable();
            $table->timestampTz('decided_at');
            $table->timestampsTz();
            $table->unique(['request_id', 'step_position', 'actor_id']);
        });
        DB::statement("ALTER TABLE approval_flow_steps ADD CONSTRAINT approval_step_mode CHECK (mode IN ('any_of', 'all_of')), ADD CONSTRAINT approval_step_type CHECK (approver_type IN ('role', 'user')), ADD CONSTRAINT approval_step_range CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)");
        DB::statement("ALTER TABLE approval_requests ADD CONSTRAINT approval_request_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))");
        DB::statement("ALTER TABLE approval_decisions ADD CONSTRAINT approval_decision_value CHECK (decision IN ('approve', 'reject'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_decisions');
        Schema::dropIfExists('approval_request_approvers');
        Schema::dropIfExists('approval_requests');
        Schema::dropIfExists('approval_flow_steps');
        Schema::dropIfExists('approval_flows');
    }
};
