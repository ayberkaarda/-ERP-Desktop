<?php

declare(strict_types=1);

namespace App\Core\Http;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Maps every exception on API requests to the shared error envelope.
 */
final class ExceptionRenderer
{
    public static function shouldRender(Request $request): bool
    {
        return $request->is('api/*') || $request->expectsJson();
    }

    public function __invoke(Throwable $e, Request $request): ?Response
    {
        if (! self::shouldRender($request)) {
            return null;
        }

        return match (true) {
            // The thrower already built the exact response it wants sent.
            $e instanceof HttpResponseException => $e->getResponse(),
            $e instanceof ValidationException => ApiResponse::error(
                ErrorCode::ValidationError,
                fields: $this->fields($e),
                status: $e->status,
            ),
            $e instanceof AuthenticationException => ApiResponse::error(ErrorCode::Unauthenticated),
            $e instanceof AuthorizationException => ApiResponse::error(ErrorCode::Forbidden),
            $e instanceof ModelNotFoundException => ApiResponse::error(ErrorCode::NotFound),
            $e instanceof HttpExceptionInterface => $this->fromHttpException($e),
            default => ApiResponse::error(ErrorCode::ServerError),
        };
    }

    private function fromHttpException(HttpExceptionInterface $e): JsonResponse
    {
        $status = $e->getStatusCode();

        /** @var array<string, string> $headers */
        $headers = $e->getHeaders();

        return ApiResponse::error(ErrorCode::fromStatus($status), status: $status, headers: $headers);
    }

    /**
     * @return array<string, list<string>>
     */
    private function fields(ValidationException $e): array
    {
        /** @var array<string, list<string>> $errors */
        $errors = $e->errors();

        return $errors;
    }
}
