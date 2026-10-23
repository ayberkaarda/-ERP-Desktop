<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Services;

use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\Sales\Contracts\EDocumentSourceGuard;

final class SourceGuard implements EDocumentSourceGuard
{
    public function assertReversible(string $type, string $id): void
    {
        if (Document::query()->where('direction', 'outgoing')->where('source_type', $type)->where('source_id', $id)->whereNotNull('provider_key')->whereNotIn('status', ['rejected', 'cancelled'])->exists()) {
            throw new EDocumentException('EDOC_SOURCE_LOCKED', 'An electronic document submission exists for this source. Resolve its electronic document lifecycle before reversing it.');
        }
    }
}
