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
        Schema::create('edocument_operations', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies');
            $t->foreignUuid('user_id')->constrained('users');
            $t->string('key', 255);
            $t->string('fingerprint', 64);
            $t->string('state', 20);
            $t->timestampTz('lease_until');
            $t->uuid('claim_token')->nullable();
            $t->jsonb('response')->nullable();
            $t->integer('response_status')->nullable();
            $t->timestampsTz();
            $t->unique(['company_id', 'user_id', 'key']);
        });
        Schema::create('edocuments', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies');
            $t->foreignUuid('created_by')->constrained('users');
            $t->uuid('operation_id')->nullable()->unique();
            $t->string('direction', 12);
            $t->string('kind', 20);
            $t->string('profile', 30);
            $t->string('status', 20);
            $t->uuid('uuid');
            $t->string('number', 16)->nullable();
            $t->string('series', 3);
            $t->date('document_date');
            $t->string('currency_code', 3);
            $t->decimal('total', 20, 4);
            $t->string('party_name', 255);
            $t->string('source_type', 20)->nullable();
            $t->uuid('source_id')->nullable();
            $t->string('source_number')->nullable();
            $t->integer('source_version')->nullable();
            $t->string('source_hash', 64)->nullable();
            $t->uuid('purchase_invoice_id')->nullable();
            $t->jsonb('snapshot');
            $t->jsonb('metadata');
            $t->jsonb('validation');
            $t->text('xml')->nullable();
            $t->string('xml_hash', 64)->nullable();
            $t->uuid('provider_key')->nullable()->unique();
            $t->string('provider_id')->nullable();
            $t->integer('version')->default(1);
            $t->timestampsTz();
            $t->unique(['company_id', 'uuid']);
            $t->unique(['id', 'company_id']);
            $t->index(['company_id', 'direction', 'created_at']);
        });
        DB::statement("CREATE UNIQUE INDEX edocument_active_source_unique ON edocuments (company_id, source_type, source_id) WHERE direction = 'outgoing' AND status <> 'cancelled'");
        DB::statement("CREATE UNIQUE INDEX edocument_outgoing_number_unique ON edocuments (company_id, source_type, number) WHERE direction = 'outgoing' AND number IS NOT NULL");
        Schema::create('edocument_events', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->uuid('company_id');
            $t->uuid('document_id');
            $t->foreignUuid('user_id')->nullable()->constrained('users');
            $t->string('event', 40);
            $t->string('from_status', 20)->nullable();
            $t->string('to_status', 20);
            $t->string('message', 500);
            $t->timestampsTz();
            $t->foreign(['document_id', 'company_id'])->references(['id', 'company_id'])->on('edocuments')->cascadeOnDelete();
        });
        Schema::create('edocument_sandbox_receipts', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies');
            $t->uuid('provider_key');
            $t->uuid('document_uuid');
            $t->string('xml_hash', 64);
            $t->string('status', 20);
            $t->timestampsTz();
            $t->unique(['company_id', 'provider_key']);
        });
        Schema::create('edocument_sandbox_taxpayers', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies');
            $t->string('tax_number', 11);
            $t->string('name');
            $t->jsonb('aliases');
            $t->timestampsTz();
            $t->unique(['company_id', 'tax_number']);
        });
        Schema::create('edocument_sandbox_inbox', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('company_id')->constrained('companies');
            $t->text('xml');
            $t->string('xml_hash', 64);
            $t->string('state', 20)->default('pending');
            $t->string('error', 500)->nullable();
            $t->uuid('document_id')->nullable();
            $t->timestampsTz();
            $t->unique(['company_id', 'xml_hash']);
        });
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION guard_edocument_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.number IS NOT NULL AND ROW(NEW.company_id,NEW.direction,NEW.kind,NEW.profile,NEW.uuid,NEW.number,NEW.series,NEW.document_date,NEW.currency_code,NEW.total,NEW.party_name,NEW.source_type,NEW.source_id,NEW.source_hash,NEW.snapshot,NEW.xml,NEW.xml_hash)
                    IS DISTINCT FROM ROW(OLD.company_id,OLD.direction,OLD.kind,OLD.profile,OLD.uuid,OLD.number,OLD.series,OLD.document_date,OLD.currency_code,OLD.total,OLD.party_name,OLD.source_type,OLD.source_id,OLD.source_hash,OLD.snapshot,OLD.xml,OLD.xml_hash) THEN
                    RAISE EXCEPTION 'Validated electronic document snapshot is immutable' USING ERRCODE='23514';
                END IF;
                IF OLD.number IS NOT NULL AND OLD.direction='outgoing' AND NEW.metadata IS DISTINCT FROM OLD.metadata THEN
                    RAISE EXCEPTION 'Validated electronic document metadata is immutable' USING ERRCODE='23514';
                END IF;
                IF OLD.provider_key IS NOT NULL AND NEW.provider_key IS DISTINCT FROM OLD.provider_key THEN
                    RAISE EXCEPTION 'Electronic document provider key is immutable' USING ERRCODE='23514';
                END IF;
                IF OLD.purchase_invoice_id IS NOT NULL AND NEW.purchase_invoice_id IS DISTINCT FROM OLD.purchase_invoice_id THEN
                    RAISE EXCEPTION 'Electronic document purchase link is immutable' USING ERRCODE='23514';
                END IF;
                RETURN NEW;
            END
            $$
            SQL);
        DB::statement('CREATE TRIGGER edocument_snapshot_immutable BEFORE UPDATE ON edocuments FOR EACH ROW EXECUTE FUNCTION guard_edocument_snapshot()');
    }

    public function down(): void
    {
        foreach (['edocument_sandbox_inbox', 'edocument_sandbox_taxpayers', 'edocument_sandbox_receipts', 'edocument_events', 'edocuments', 'edocument_operations'] as $table) {
            Schema::dropIfExists($table);
        }
        DB::statement('DROP FUNCTION IF EXISTS guard_edocument_snapshot()');
    }
};
