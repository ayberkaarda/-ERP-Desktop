<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

/**
 * Who a key belongs to. Keys never collide across users, companies or namespaces: the stored
 * scope_hash is sha256(user, company[, namespace], key). The HTTP middleware uses no
 * namespace, which keeps its hashes identical to those stored before namespaces existed.
 */
final readonly class IdempotencyScope
{
    public function __construct(
        public string $key,
        public ?string $userId,
        public ?string $companyId,
        public string $namespace = '',
    ) {}

    public function hash(): string
    {
        $parts = $this->namespace === ''
            ? [$this->userId ?? '', $this->companyId ?? '', $this->key]
            : [$this->userId ?? '', $this->companyId ?? '', $this->namespace, $this->key];

        return hash('sha256', implode("\0", $parts));
    }
}
