<?php

declare(strict_types=1);

namespace App\Core\Http;

use Illuminate\Http\JsonResponse;

final class ApiResponse
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public static function success(mixed $data, array $meta = [], int $status = 200): JsonResponse
    {
        $body = ['data' => $data];

        if ($meta !== []) {
            $body['meta'] = $meta;
        }

        return new JsonResponse($body, $status);
    }

    public static function created(mixed $data): JsonResponse
    {
        return self::success($data, status: 201);
    }

    public static function noContent(): JsonResponse
    {
        return new JsonResponse(null, 204);
    }

    /**
     * @param  array<string, list<string>>|null  $fields
     * @param  array<string, string>  $headers
     */
    public static function error(
        ErrorCode $code,
        ?string $message = null,
        ?array $fields = null,
        ?int $status = null,
        array $headers = [],
    ): JsonResponse {
        $error = [
            'message' => $message ?? $code->message(),
            'code' => $code->value,
        ];

        if ($fields !== null) {
            $error['fields'] = $fields;
        }

        return new JsonResponse(['errors' => $error], $status ?? $code->status(), $headers);
    }
}
