<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

use App\Modules\Sales\Data\EDocumentSource;

interface EDocumentSources
{
    public function snapshot(string $type, string $id, bool $lock = false): EDocumentSource;

    /** @return array{records:list<array<string,mixed>>,total:int} */
    public function candidates(string $type, string $search, int $page): array;
}
