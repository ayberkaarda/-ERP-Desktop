<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Cursor;
use InvalidArgumentException;

final readonly class CursorTags
{
    private string $key;

    public function __construct(string $appKey)
    {
        $secret = str_starts_with($appKey, 'base64:') ? base64_decode(substr($appKey, 7), true) : $appKey;

        if ($secret === false || $secret === '') {
            throw new InvalidArgumentException('A valid application key is required for sync cursor tags.');
        }

        $this->key = hash_hmac('sha256', 'sync-cursor-tag', $secret);
    }

    public function issue(string $userId, string $companyId, string $resource, Cursor $cursor): string
    {
        $input = implode('|', ['sync-cursor', '1', $userId, $companyId, $resource, $cursor->txid->value, $cursor->afterId ?? '', (string) $cursor->gen]);
        $mac = hash_hmac('sha256', $input, $this->key, true);

        return 'i_'.rtrim(strtr(base64_encode($mac), '+/', '-_'), '=');
    }

    public function verify(string $userId, string $companyId, string $resource, Cursor $cursor, string $tag): bool
    {
        return hash_equals($this->issue($userId, $companyId, $resource, $cursor), $tag);
    }

    public function isTag(string $session): bool
    {
        return str_starts_with($session, 'i_');
    }
}
