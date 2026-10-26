<?php

declare(strict_types=1);

namespace Tests\Support\Accounting;

use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Services\JournalDrafts;
use DateTimeImmutable;

/**
 * The worked example of the report tests (fiscal year 2027, fixture chart):
 *
 *   E1 2027-01-10  100 Kasa 10000.00 D        / 500 Sermaye 10000.00 C              (opening)
 *   E2 2027-02-05  153 2000.00 D, 191 400.00 D / 320 2400.00 C (party 0)
 *   E3 2027-02-20  120 3600.00 D (party 1)     / 600 3000.00 C, 391 600.00 C
 *   E4 2027-03-15  102 3600.00 D               / 120 3600.00 C (party 1)
 *   E5 2027-02-25  770 500.00 D                / 100 500.00 C, reversed by
 *   R5 2027-03-05  100 500.00 D                / 770 500.00 C
 *   D  2027-03-31  draft 770 999.00 D / 100 999.00 C (never counts)
 *
 * Numbers follow the posting order: E1..E4 = ...001..004, E5 = ...005, R5 = ...006.
 */
final class ReportBooks
{
    /**
     * @return array<string, string> entry ids by label
     */
    public static function seed(string $company): array
    {
        [$p0, $p1] = Books::$parties;
        $ids = [];
        $ids['E1'] = Books::post($company, '2027-01-10', [['100', '10000.00', '0'], ['500', '0', '10000.00']], EntryType::Opening)->id;
        $ids['E2'] = Books::post($company, '2027-02-05', [['153', '2000.00', '0'], ['191', '400.00', '0'], ['320', '0', '2400.00', ['partyId' => $p0]]])->id;
        $ids['E3'] = Books::post($company, '2027-02-20', [['120', '3600.00', '0', ['partyId' => $p1]], ['600', '0', '3000.00'], ['391', '0', '600.00']])->id;
        $ids['E4'] = Books::post($company, '2027-03-15', [['102', '3600.00', '0'], ['120', '0', '3600.00', ['partyId' => $p1]]])->id;
        $ids['E5'] = Books::post($company, '2027-02-25', [['770', '500.00', '0'], ['100', '0', '500.00']])->id;
        $ids['R5'] = Books::in($company, fn () => app(PostingService::class)->reverse($ids['E5'], new DateTimeImmutable('2027-03-05'), 'wrong account'))->id;
        $ids['D'] = Books::in($company, fn () => app(JournalDrafts::class)->create([
            'entry_type' => 'general', 'entry_date' => '2027-03-31',
            'lines' => [['account_code' => '770', 'debit' => '999'], ['account_code' => '100', 'credit' => '999']],
        ], null))->id;

        return $ids;
    }
}
