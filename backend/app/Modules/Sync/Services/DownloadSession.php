<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Xid8;

/**
 * A full-download session as read for one continuation request: its row key, id and version,
 * the cursor hash the request presented and whether that is the session's latest cursor
 * (false: the one before it, a retried request).
 */
final readonly class DownloadSession
{
    public function __construct(
        public string $device,
        public string $userId,
        public string $companyId,
        public string $resource,
        public string $sessionId,
        public int $version,
        public string $presentedHash,
        public bool $atLatest,
        public Xid8 $started,
    ) {}
}
