<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Exceptions;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;

final class EDocumentException extends HttpResponseException
{
    public function __construct(public readonly string $errorCode, string $message, int $status = 409)
    {
        parent::__construct(new JsonResponse(['errors' => ['code' => $errorCode, 'message' => $message]], $status));
    }
}
