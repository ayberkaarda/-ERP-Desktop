<?php

declare(strict_types=1);

namespace App\Core\Http;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

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

    /**
     * {data: [...], meta: {pagination: {...}}}
     *
     * @param  LengthAwarePaginator<int, mixed>  $paginator
     * @param  class-string<JsonResource>  $resourceClass
     */
    public static function paginated(LengthAwarePaginator $paginator, string $resourceClass): JsonResponse
    {
        $data = $resourceClass::collection($paginator->items())->resolve(request());

        return self::success($data, [
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
        ]);
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
