<?php

declare(strict_types=1);

namespace App\Modules\Organization\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Contracts\EDocumentCompany;
use App\Modules\Organization\Models\Company;

final readonly class EDocumentCompanyProfile implements EDocumentCompany
{
    public function profile(): array
    {
        $company = Company::query()->findOrFail(app(CompanyContext::class)->id());

        return ['name' => $company->legal_name ?: $company->name, 'tax_number' => $company->tax_number, 'tax_office' => $company->tax_office, 'country_code' => $company->country_code, 'base_currency' => $company->base_currency, 'address' => ['street' => $company->address ?? '', 'city' => '', 'district' => '', 'postal_code' => '', 'country_code' => $company->country_code]];
    }
}
