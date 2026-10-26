<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

final readonly class Claim
{
    private function __construct(
        public ClaimStatus $status,
        /** Fencing token of a claim we hold; every later write of ours is guarded by it. */
        public ?string $claimId = null,
        public ?StoredResponse $response = null,
    ) {}

    public static function claimed(string $claimId): self
    {
        return new self(ClaimStatus::Claimed, $claimId);
    }

    public static function completed(StoredResponse $response): self
    {
        return new self(ClaimStatus::Completed, response: $response);
    }

    public static function reused(): self
    {
        return new self(ClaimStatus::Reused);
    }

    public static function inProgress(): self
    {
        return new self(ClaimStatus::InProgress);
    }
}
