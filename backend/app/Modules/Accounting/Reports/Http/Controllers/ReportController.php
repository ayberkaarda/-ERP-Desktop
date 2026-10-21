<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Reports\Data\Amounts;
use App\Modules\Accounting\Reports\Data\JournalBook;
use App\Modules\Accounting\Reports\Data\LedgerLine;
use App\Modules\Accounting\Reports\Data\LedgerPage;
use App\Modules\Accounting\Reports\Data\ReportRange;
use App\Modules\Accounting\Reports\Data\TrialBalance;
use App\Modules\Accounting\Reports\Http\Requests\AccountStatementRequest;
use App\Modules\Accounting\Reports\Http\Requests\GeneralLedgerRequest;
use App\Modules\Accounting\Reports\Http\Requests\JournalBookRequest;
use App\Modules\Accounting\Reports\Http\Requests\ReportRequest;
use App\Modules\Accounting\Reports\Http\Requests\TrialBalanceRequest;
use App\Modules\Accounting\Reports\Http\Resources\JournalBookEntryResource;
use App\Modules\Accounting\Reports\Http\Resources\LedgerLineResource;
use App\Modules\Accounting\Reports\Http\Resources\TrialBalanceResource;
use App\Modules\Accounting\Reports\Services\AccountStatementReport;
use App\Modules\Accounting\Reports\Services\GeneralLedgerReport;
use App\Modules\Accounting\Reports\Services\JournalBookReport;
use App\Modules\Accounting\Reports\Services\RangeResolver;
use App\Modules\Accounting\Reports\Services\TrialBalanceReport;
use App\Modules\Accounting\Reports\Support\ReadSnapshot;
use App\Modules\Accounting\Reports\Support\ReportExporter;
use App\Modules\Accounting\Support\Messages;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Accounting reports (permission accounting.reports.view, active company only). Ranges: `period_id`
 * or inclusive `date_from`/`date_to`. Only booked entries count (posted, and reversed ones together
 * with their reversal); drafts never do. Each report runs in one read-only snapshot.
 */
final class ReportController
{
    // Request-scoped services are resolved per call: the router keeps one controller instance.
    public function __construct(private readonly RangeResolver $ranges) {}

    /**
     * Mizan (trial balance).
     *
     * Rows in account code order down to `level`, TDHP class subtotals (`groups`), grand totals and
     * the debit = credit check (`balanced`). From account_balances when the range is period aligned
     * (`source`: balances), from the booked lines otherwise.
     */
    public function trialBalance(TrialBalanceRequest $request, TrialBalanceReport $report): TrialBalanceResource
    {
        return new TrialBalanceResource(ReadSnapshot::run(fn (): TrialBalance => $this->trialBalanceOf($request, $report)));
    }

    /** Mizan as CSV (default) or XLSX. */
    public function trialBalanceExport(TrialBalanceRequest $request, TrialBalanceReport $report): StreamedResponse|BinaryFileResponse
    {
        $result = ReadSnapshot::run(fn (): TrialBalance => $this->trialBalanceOf($request, $report));
        $compare = $result->previousTotals !== null;
        $headings = ['code', 'name', 'level', 'tdhp_group', 'opening_debit', 'opening_credit', 'debit', 'credit', 'total_debit', 'total_credit', 'balance_debit', 'balance_credit'];

        if ($compare) {
            array_push($headings, 'previous_debit', 'previous_credit', 'previous_balance_debit', 'previous_balance_credit');
        }

        ReportExporter::assertWithinCap(count($result->rows) + 1);
        $rows = [];

        foreach ($result->rows as $row) {
            $amounts = $row->amounts->toArray();
            $line = [$row->account->code, $row->account->name, $row->account->level, $row->account->tdhp_group, ...array_values($amounts)];

            $rows[] = $compare ? [...$line, ...self::previousCells($row->previous)] : $line;
        }

        $total = [Messages::get('report_total'), '', null, null, ...array_values($result->totals->toArray())];
        $rows[] = $compare ? [...$total, ...self::previousCells($result->previousTotals)] : $total;

        return ReportExporter::download('trial-balance', $request->exportFormat(), $headings, $rows);
    }

    /**
     * Büyük defter (general ledger) of one account.
     *
     * Lines of the range in date and entry number order with a running balance that continues
     * across pages; meta carries the account, opening and closing balance and the range totals.
     */
    public function generalLedger(GeneralLedgerRequest $request, GeneralLedgerReport $report): AnonymousResourceCollection
    {
        [$account, $page] = ReadSnapshot::run(function () use ($request, $report): array {
            $account = Account::query()->findOrFail($request->accountId());

            return [$account, $report->build($this->companyId(), $account, $this->range($request), $request->page(), $request->perPage())];
        });

        return LedgerLineResource::collection($this->withParties($page))->additional(['meta' => [
            'pagination' => $page->pagination(),
            ...$page->range->toArray(),
            'source' => $page->source->value,
            'account' => [
                'id' => $account->id,
                'code' => $account->code,
                'name' => $account->name,
                'normal_balance' => $account->normal_balance->value,
                'is_postable' => $account->is_postable,
                'currency_code' => $account->currency_code,
                'requires_party' => $account->requires_party,
                'requires_cost_center' => $account->requires_cost_center,
                'requires_project' => $account->requires_project,
            ],
            ...$page->figures(),
        ]]);
    }

    /** Büyük defter as CSV (default) or XLSX: every line of the range. */
    public function generalLedgerExport(GeneralLedgerRequest $request, GeneralLedgerReport $report): StreamedResponse|BinaryFileResponse
    {
        $page = ReadSnapshot::run(function () use ($request, $report): LedgerPage {
            $account = Account::query()->findOrFail($request->accountId());
            $range = $this->range($request);
            ReportExporter::assertWithinCap($report->count($this->companyId(), $range, $account) + 2);

            return $report->build($this->companyId(), $account, $range, 1, null);
        });

        return $this->ledgerDownload('general-ledger', $request, $page);
    }

    /**
     * Yevmiye defteri (journal book).
     *
     * Booked entries in journal order (fiscal year, number) with their lines, paginated by entry.
     * meta.carried_forward: totals of the same fiscal year before the range; page_brought_forward
     * (devreden), page_totals and page_carried_forward (nakledilen) for the requested page.
     */
    public function journalBook(JournalBookRequest $request, JournalBookReport $report): AnonymousResourceCollection
    {
        $book = ReadSnapshot::run(fn (): JournalBook => $report->build($this->companyId(), $this->range($request), $request->page(), $request->perPage()));

        return JournalBookEntryResource::collection($book->entries)->additional([
            'meta' => [
                'pagination' => ['current_page' => $book->page, 'per_page' => $book->perPage, 'total' => $book->total, 'last_page' => $book->lastPage()],
                ...$book->range->toArray(),
                'source' => $book->source->value,
                'carried_forward' => JournalBook::str($book->carriedForward),
                'page_brought_forward' => JournalBook::str($book->pageBroughtForward),
                'page_totals' => JournalBook::str($book->pageTotals),
                'page_carried_forward' => JournalBook::str($book->pageCarriedForward()),
                'range_totals' => JournalBook::str($book->rangeTotals),
            ],
        ]);
    }

    /** Yevmiye defteri as CSV (default) or XLSX: one row per line, devreden first and total last. */
    public function journalBookExport(JournalBookRequest $request, JournalBookReport $report): StreamedResponse|BinaryFileResponse
    {
        $book = ReadSnapshot::run(function () use ($request, $report): JournalBook {
            $range = $this->range($request);
            ReportExporter::assertWithinCap($report->lineCount($this->companyId(), $range) + 2);

            return $report->build($this->companyId(), $range, 1, null);
        });
        $carried = JournalBook::str($book->carriedForward);
        $end = JournalBook::str($book->pageCarriedForward());
        $rows = [['', '', '', '', Messages::get('report_brought_forward'), null, '', '', '', $carried['debit'], $carried['credit']]];

        foreach ($book->entries as $entry) {
            foreach ($entry->lines as $line) {
                $rows[] = [
                    $entry->number, $entry->entryDate, $entry->entryType, $entry->status, $entry->description,
                    $line->lineNo, $line->accountCode, $line->accountName, $line->description, $line->debit, $line->credit,
                ];
            }
        }

        $rows[] = ['', '', '', '', Messages::get('report_total'), null, '', '', '', $end['debit'], $end['credit']];

        return ReportExporter::download('journal-book', $request->exportFormat(), [
            'number', 'entry_date', 'entry_type', 'status', 'entry_description', 'line_no', 'account_code', 'account_name',
            'line_description', 'debit', 'credit',
        ], $rows);
    }

    /**
     * Cari hesap ekstresi (account statement) base of one party.
     *
     * Booked lines carrying the party, optionally within an account code range, with opening
     * balance, running balance across pages, range totals and closing balance.
     */
    public function accountStatement(AccountStatementRequest $request, AccountStatementReport $report): AnonymousResourceCollection
    {
        $page = ReadSnapshot::run(fn (): LedgerPage => $report->build(
            $this->companyId(), $request->partyId(), $request->accountFrom(), $request->accountTo(),
            $this->range($request), $request->page(), $request->perPage(),
        ));
        $party = $this->party($request->partyId());

        return LedgerLineResource::collection($this->withParties($page))->additional(['meta' => [
            'pagination' => $page->pagination(),
            ...$page->range->toArray(),
            'source' => $page->source->value,
            'party_id' => $request->partyId(),
            'party' => $party === null || $party->companyId !== $this->companyId() ? null : ['id' => $party->id, 'code' => $party->code, 'name' => $party->name],
            'account_from' => $request->accountFrom(),
            'account_to' => $request->accountTo(),
            ...$page->figures(),
        ]]);
    }

    /** Account statement as CSV (default) or XLSX: every line of the range. */
    public function accountStatementExport(AccountStatementRequest $request, AccountStatementReport $report): StreamedResponse|BinaryFileResponse
    {
        $page = ReadSnapshot::run(function () use ($request, $report): LedgerPage {
            $range = $this->range($request);
            $args = [$this->companyId(), $request->partyId(), $request->accountFrom(), $request->accountTo()];
            ReportExporter::assertWithinCap($report->count(...$args, range: $range) + 2);

            return $report->build(...$args, range: $range, page: 1, perPage: null);
        });

        return $this->ledgerDownload('account-statement', $request, $page);
    }

    /**
     * Previous-year movement and balance cells of a trial balance export row.
     *
     * @return list<string>
     */
    private static function previousCells(?Amounts $amounts): array
    {
        if ($amounts === null) {
            return ['', '', '', ''];
        }

        $values = $amounts->toArray();

        return [$values['debit'], $values['credit'], $values['balance_debit'], $values['balance_credit']];
    }

    private function trialBalanceOf(TrialBalanceRequest $request, TrialBalanceReport $report): TrialBalance
    {
        return $report->build($this->companyId(), $this->range($request), $request->level(), $request->includeZero(), $request->compare());
    }

    private function companyId(): string
    {
        return app(CompanyContext::class)->id();
    }

    private function party(string $id): ?PartyData
    {
        return app(PartyLookup::class)->find($id);
    }

    private function range(ReportRequest $request): ReportRange
    {
        return $this->ranges->resolve($request->periodId(), $request->dateFrom(), $request->dateTo());
    }

    /**
     * The page's lines with their party (when it belongs to the active company).
     *
     * @return list<LedgerLine>
     */
    private function withParties(LedgerPage $page): array
    {
        $parties = [];

        foreach ($page->lines as $line) {
            if ($line->partyId !== null && ! array_key_exists($line->partyId, $parties)) {
                $party = $this->party($line->partyId);
                $parties[$line->partyId] = $party !== null && $party->companyId === $this->companyId() ? $party : null;
            }
        }

        return array_map(
            static fn (LedgerLine $line): LedgerLine => $line->partyId === null ? $line : $line->withParty($parties[$line->partyId]),
            $page->lines,
        );
    }

    private function ledgerDownload(string $name, ReportRequest $request, LedgerPage $page): StreamedResponse|BinaryFileResponse
    {
        $figures = $page->figures();
        $rows = [['', '', '', '', '', Messages::get('report_opening'), '', '', '', '', $figures['opening_balance']]];

        foreach ($page->lines as $line) {
            $rows[] = [
                $line->entryDate, $line->entryNumber, $line->entryType, $line->accountCode, $line->accountName,
                $line->description, $line->partyId, $line->documentRef, $line->debit, $line->credit, $line->runningBalance,
            ];
        }

        $rows[] = ['', '', '', '', '', Messages::get('report_total'), '', '', $figures['totals']['debit'], $figures['totals']['credit'], $figures['closing_balance']];

        return ReportExporter::download($name, $request->exportFormat(), [
            'entry_date', 'entry_number', 'entry_type', 'account_code', 'account_name', 'description', 'party_id',
            'document_ref', 'debit', 'credit', 'running_balance',
        ], $rows);
    }
}
