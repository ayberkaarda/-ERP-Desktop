<?php

declare(strict_types=1);
use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        foreach (app(CompanyDirectory::class)->allActiveCompanies() as $company) {
            app(CompanyContext::class)->runAs($company['id'], fn () => app(DeterminationRules::class)->ensureDefaults(ExpenseScheme::A));
        }
    }

    public function down(): void {}
};
