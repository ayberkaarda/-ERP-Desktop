<?php

declare(strict_types=1);

namespace App\Core\Sync;

/**
 * Company scope of a sync resource (common.schema.json#/$defs/scope).
 */
enum SyncScope: string
{
    /** company_id = the active company. */
    case Company = 'company';

    /** company_id IS NULL (system rows such as TCMB rates) or the active company. */
    case CompanyOrGlobal = 'company_or_global';

    /** Global rows whose per-company state lives in an activation table; position is the larger of both. */
    case GlobalWithCompanyActivation = 'global_with_company_activation';
}
