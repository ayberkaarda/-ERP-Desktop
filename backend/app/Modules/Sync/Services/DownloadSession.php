<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Xid8;

/**
 * A full-download session as read for one continuation request: its row key, its id and the
 * cursor hash the request presented (App\Modules\Sync\Services\FullDownloads).
 */
final readonly class DownloadSession
{
    public function __construct(
        public string $device,
        public string $userId,
        public string $companyId,
        public string $resource,
        public string $sessionId,
        public string $presentedHash,
        public Xid8 $started,
    ) {}
}
