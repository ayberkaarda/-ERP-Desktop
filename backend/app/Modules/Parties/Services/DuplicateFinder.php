<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Modules\Parties\Models\Party;
use Illuminate\Database\Eloquent\Builder;

/**
 * Possible duplicates inside the active company (company scope of Party): exact tax number, or a
 * name / legal name trigram-similar to the given name (pg_trgm `%`, which uses the GIN indexes and
 * pg_trgm.similarity_threshold, default 0.3). Inactive parties are included, deleted ones are not.
 */
final class DuplicateFinder
{
    public const int LIMIT = 20;

    /**
     * @return list<array{party: Party, reasons: list<string>, similarity: float}>
     */
    public function find(?string $taxNumber, ?string $name, ?string $excludeId = null): array
    {
        $taxNumber = $taxNumber === null || trim($taxNumber) === '' ? null : trim($taxNumber);
        $name = $name === null || trim($name) === '' ? null : trim($name);

        if ($taxNumber === null && $name === null) {
            return [];
        }

        $query = Party::query()->select('parties.*');

        if ($name !== null) {
            $query->selectRaw("greatest(similarity(name, ?), similarity(coalesce(legal_name, ''), ?)) as name_similarity", [$name, $name])
                ->selectRaw("(name % ? or coalesce(legal_name, '') % ?) as name_match", [$name, $name]);
        } else {
            $query->selectRaw('0::real as name_similarity, false as name_match');
        }

        $query->where(function (Builder $w) use ($taxNumber, $name): void {
            if ($taxNumber !== null) {
                $w->orWhere('tax_number', $taxNumber);
            }

            if ($name !== null) {
                $w->orWhereRaw('name % ?', [$name])->orWhereRaw('legal_name % ?', [$name]);
            }
        });

        if ($excludeId !== null) {
            $query->whereKeyNot($excludeId);
        }

        if ($taxNumber !== null) {
            $query->orderByRaw('coalesce(tax_number = ?, false) desc', [$taxNumber]);
        }

        $matches = [];

        foreach ($query->orderByDesc('name_similarity')->orderBy('code')->limit(self::LIMIT)->get() as $party) {
            $similarity = $party->getAttribute('name_similarity');
            $matches[] = [
                'party' => $party,
                'reasons' => self::reasons($party, $taxNumber),
                'similarity' => is_numeric($similarity) ? round((float) $similarity, 4) : 0.0,
            ];
        }

        return $matches;
    }

    /** @return list<string> */
    private static function reasons(Party $party, ?string $taxNumber): array
    {
        $reasons = [];

        if ($taxNumber !== null && $party->tax_number === $taxNumber) {
            $reasons[] = 'tax_number';
        }

        if ($party->getAttribute('name_match') === true) {
            $reasons[] = 'name';
        }

        return $reasons;
    }
}
