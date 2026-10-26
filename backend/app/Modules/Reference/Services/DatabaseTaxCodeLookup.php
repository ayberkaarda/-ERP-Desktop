<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Reference\Data\TaxCodeData;
use App\Modules\Reference\Enums\TaxType;
use App\Modules\Reference\Models\TaxCode;
use DateTimeInterface;
use Illuminate\Support\Str;

final class DatabaseTaxCodeLookup implements TaxCodeLookup
{
    public function find(string $idOrCode, ?DateTimeInterface $date = null): ?TaxCodeData
    {
        $day = $date?->format('Y-m-d') ?? now('Europe/Istanbul')->toDateString();
        $query = TaxCode::query()->where(Str::isUuid($idOrCode) ? 'id' : 'code', $idOrCode)
            ->where('is_active', true)->where('effective_from', '<=', $day)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>=', $day));
        $company = app(CompanyContext::class)->idOrNull();
        if ($company !== null) {
            $query->orderByRaw('CASE WHEN company_id = ? THEN 0 ELSE 1 END', [$company]);
        }
        $record = $query->orderByDesc('effective_from')->first();
        if ($record === null) {
            return null;
        }
        /** @var TaxType $type */
        $type = $record->getAttribute('type');
        /** @var array<string, mixed> $meta */
        $meta = $record->getAttribute('meta') ?? [];

        return new TaxCodeData(
            (string) $record->getKey(), (string) $record->getAttribute('code'), $type,
            $record->getAttribute('rate'), $record->getAttribute('numerator'), $record->getAttribute('denominator'),
            (string) $record->getAttribute('effective_from'), $record->getAttribute('effective_to'), $meta,
        );
    }
}
