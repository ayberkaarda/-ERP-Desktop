<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Exceptions;

use App\Modules\Purchasing\Support\Messages;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;

/**
 * 422 with the module code purchasing.match_failed and the three-way match breakdown in
 * errors.details. Core's ErrorCode enum is closed, so the envelope is built here.
 */
final class MatchFailed extends HttpResponseException
{
    public const string CODE = 'purchasing.match_failed';

    /**
     * @param  array<string, mixed>  $details
     */
    public function __construct(public readonly array $details)
    {
        $message = Messages::get('match_failed');

        parent::__construct(new JsonResponse(['errors' => [
            'message' => $message,
            'code' => self::CODE,
            'fields' => ['lines' => [$message]],
            'details' => $details,
        ]], 422));
    }
}
