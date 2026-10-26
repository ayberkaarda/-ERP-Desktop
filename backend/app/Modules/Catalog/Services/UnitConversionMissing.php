<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;

final class UnitConversionMissing extends ApiException
{
    public function __construct(public readonly string $fromUnitId, public readonly string $toUnitId, string $field = 'unit_id')
    {
        $message = __('catalog::messages.conversion_missing');

        parent::__construct(ErrorCode::ValidationError, $message, [$field => [$message]]);
    }
}
