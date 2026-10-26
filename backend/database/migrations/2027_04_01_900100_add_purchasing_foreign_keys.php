<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        (new MasterDataIntegrity(DB::connection()))->addKeys(
            MasterDataIntegrity::purchasingKeys(),
            'Purchasing rows are never changed automatically: restore the referenced records or delete the affected drafts and retry.',
        );
    }

    public function down(): void
    {
        (new MasterDataIntegrity(DB::connection()))->dropKeys(MasterDataIntegrity::purchasingKeys());
    }
};
