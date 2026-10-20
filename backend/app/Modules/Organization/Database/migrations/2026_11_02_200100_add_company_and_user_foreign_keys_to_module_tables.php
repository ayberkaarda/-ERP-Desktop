<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Foreign keys from the settings, notifications, files and workflow tables to companies and users.
 * Dated 2026_11_02 so it runs after those modules' 2026_11_01_3xxxxx/4xxxxx migrations.
 *
 * Choices:
 * - company_id: RESTRICT for records that are audit evidence or business documents (files,
 *   settings_audit, approval requests/decisions/approvers, approval flows and steps): purging a
 *   tenant must be a deliberate process, never a side effect. CASCADE for disposable per-company
 *   state (settings values, notifications). Companies are normally soft deleted, so neither fires.
 * - user ids: users are soft deleted; a hard delete must not orphan or silently rewrite history.
 *   Authors that are optional on their row are SET NULL (files.uploaded_by, settings.updated_by,
 *   settings_audit.actor_id); approval requesters and decision actors are RESTRICT (approval
 *   history must keep its people); notifications belong to the user and CASCADE.
 * - Not constrained: idempotency_keys.user_id (opaque string, any authenticatable, expires),
 *   approval_request_approvers.approver_ref (a user id or a role name), files.attachable_id (polymorphic).
 */
return new class extends Migration
{
    /** @var list<array{0: string, 1: string, 2: string, 3: string}> table, column, references, on delete */
    private const array KEYS = [
        ['settings', 'company_id', 'companies', 'cascade'],
        ['settings_audit', 'company_id', 'companies', 'restrict'],
        ['notifications', 'company_id', 'companies', 'cascade'],
        ['files', 'company_id', 'companies', 'restrict'],
        ['approval_flows', 'company_id', 'companies', 'restrict'],
        ['approval_flow_steps', 'company_id', 'companies', 'restrict'],
        ['approval_requests', 'company_id', 'companies', 'restrict'],
        ['approval_request_approvers', 'company_id', 'companies', 'restrict'],
        ['approval_decisions', 'company_id', 'companies', 'restrict'],
        ['settings', 'updated_by', 'users', 'set null'],
        ['settings_audit', 'actor_id', 'users', 'set null'],
        ['notifications', 'user_id', 'users', 'cascade'],
        ['files', 'uploaded_by', 'users', 'set null'],
        ['approval_requests', 'requested_by', 'users', 'restrict'],
        ['approval_decisions', 'actor_id', 'users', 'restrict'],
    ];

    public function up(): void
    {
        foreach (self::KEYS as [$table, $column, $references, $onDelete]) {
            Schema::table($table, function (Blueprint $t) use ($column, $references, $onDelete): void {
                $t->foreign($column)->references('id')->on($references)->onDelete($onDelete);
            });
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::KEYS) as [$table, $column]) {
            Schema::table($table, function (Blueprint $t) use ($column): void {
                $t->dropForeign([$column]);
            });
        }
    }
};
