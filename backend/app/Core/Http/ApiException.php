<?php

declare(strict_types=1);

namespace App\Core\Http;

use RuntimeException;
use Throwable;

/**
 * Domain error that renders as the shared envelope with its own code and status.
 */
class ApiException extends RuntimeException
{
    /**
     * @param  array<string, list<string>>|null  $fields
     * @param  array<string, string>  $headers
     */
    public function __construct(
        public readonly ErrorCode $errorCode,
        ?string $message = null,
        public readonly ?array $fields = null,
        public readonly array $headers = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message ?? $errorCode->message(), 0, $previous);
    }

    public function status(): int
    {
        return $this->errorCode->status();
    }
}
