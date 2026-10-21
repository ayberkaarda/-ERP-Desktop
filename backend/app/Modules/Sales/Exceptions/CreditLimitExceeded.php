<?php

declare(strict_types=1);

namespace App\Modules\Sales\Exceptions;

use App\Modules\Sales\Data\CreditCheck;
use App\Modules\Sales\Support\Messages;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;

/**
 * 422 with the module code sales.credit_limit_exceeded and the breakdown (limit, exposure, this
 * document, total, available, currency) in errors.details. Core's ErrorCode enum is closed, so the
 * envelope is built here; the renderer sends it as is.
 */
final class CreditLimitExceeded extends HttpResponseException
{
    public const string CODE = 'sales.credit_limit_exceeded';

    public function __construct(public readonly CreditCheck $check)
    {
        $message = Messages::get('credit_limit_exceeded', ['limit' => (string) $check->limit, 'currency' => $check->currency]);

        parent::__construct(new JsonResponse(['errors' => [
            'message' => $message,
            'code' => self::CODE,
            'fields' => ['party_id' => [$message]],
            'details' => $check->toArray(),
        ]], 422));
    }
}
