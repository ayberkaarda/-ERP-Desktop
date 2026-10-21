<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Core\Numbering\NumberSequenceService;

/**
 * Party codes come from the Core number sequence (doc type `party`, series `P`). Party codes are
 * not per fiscal year, so one fixed sequence year is used; the format (default `{series}{seq:6}`,
 * e.g. P000001) is configurable through numbering.formats.party.
 */
final class PartyCodeGenerator
{
    public const string DOC_TYPE = 'party';

    public const string SERIES = 'P';

    public const string DEFAULT_FORMAT = '{series}{seq:6}';

    /** Placeholder year: the sequence never restarts. */
    public const int SEQUENCE_YEAR = 2000;

    public function __construct(private readonly NumberSequenceService $numbers) {}

    /**
     * Call inside the transaction that inserts the party so a rollback returns the number.
     */
    public function next(string $companyId): string
    {
        return $this->numbers->next($companyId, self::DOC_TYPE, self::SERIES, self::SEQUENCE_YEAR);
    }
}
