<?php

declare(strict_types=1);

namespace App\Core\Company;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class MissingCompanyContext extends ApiException
{
    public function __construct()
    {
        parent::__construct(ErrorCode::CompanyRequired);
    }
}
