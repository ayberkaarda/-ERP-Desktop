<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Exceptions;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;

final class AssistantException extends HttpResponseException
{
    public function __construct(public readonly string $errorCode, string $message, int $status = 409)
    {
        $key = 'assistant::messages.errors.'.$errorCode;
        $translated = __($key);
        if (is_string($translated) && $translated !== $key) {
            $message = $translated;
        }
        parent::__construct(new JsonResponse(['errors' => ['code' => $errorCode, 'message' => $message]], $status));
    }
}
