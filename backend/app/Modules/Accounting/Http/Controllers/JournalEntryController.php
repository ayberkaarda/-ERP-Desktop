<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Core\Http\ListQuery;
use App\Modules\Accounting\Http\Requests\JournalEntryRequest;
use App\Modules\Accounting\Http\Requests\PostEntryRequest;
use App\Modules\Accounting\Http\Requests\ReverseEntryRequest;
use App\Modules\Accounting\Http\Resources\JournalEntryResource;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Models\JournalLine;
use App\Modules\Accounting\Services\JournalDrafts;
use App\Modules\Accounting\Services\LedgerPoster;
use App\Modules\Accounting\Support\JournalExport;
use App\Modules\Accounting\Support\Messages;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Maatwebsite\Excel\Excel as ExcelFormat;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Filters: entry_type, status, period_id, fiscal_year_id, source_type (ListQuery) and date_from,
 * date_to, account_id, party_id, amount_min, amount_max (on total_debit); q on number/description.
 */
final class JournalEntryController extends AccountingController
{
    private const array CUSTOM = ['date_from', 'date_to', 'account_id', 'party_id', 'amount_min', 'amount_max'];

    public function __construct(
        private readonly JournalDrafts $drafts,
        private readonly LedgerPoster $poster,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', JournalEntry::class);
        [$request, $custom] = $this->customFilters($request, self::CUSTOM);
        $query = $this->filtered(JournalEntry::query()->withCount('lines'), $custom);

        if ($request->query('sort') === null) {
            $query->orderByDesc('entry_date')->orderByDesc('number');
        }

        return ApiResponse::paginated(
            ListQuery::for(
                $query,
                $request,
                ['entry_date', 'number', 'created_at', 'posted_at', 'total_debit'],
                ['entry_type', 'status', 'period_id', 'fiscal_year_id', 'source_type'],
                ['number', 'description'],
            ),
            JournalEntryResource::class,
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', JournalEntry::class);
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($id);
        Gate::authorize('view', $entry);

        $audit = $entry->activitiesAsSubject()->latest()->limit(100)->get()->map(static fn (Model $a): array => [
            'event' => $a->getAttribute('event'),
            'description' => $a->getAttribute('description'),
            'causer_id' => $a->getAttribute('causer_id'),
            'created_at' => $a->getAttribute('created_at') instanceof Carbon ? $a->getAttribute('created_at')->toIso8601String() : null,
        ])->values()->all();

        return ApiResponse::success([...$this->resolve(new JournalEntryResource($entry), $request), 'audit' => $audit]);
    }

    public function store(JournalEntryRequest $request): JsonResponse
    {
        $entry = $this->drafts->create($request->validated(), $this->actor($request));

        return ApiResponse::created($this->resolve(new JournalEntryResource($entry->load('lines.account')), $request));
    }

    public function update(JournalEntryRequest $request, string $id): JsonResponse
    {
        $entry = JournalEntry::query()->findOrFail($id);
        Gate::authorize('update', $entry);
        $entry = $this->drafts->update($entry, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new JournalEntryResource($entry->load('lines.account')), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', JournalEntry::class);
        $entry = JournalEntry::query()->findOrFail($id);
        Gate::authorize('delete', $entry);
        $this->drafts->delete($entry, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }

    public function post(PostEntryRequest $request, string $id): JsonResponse
    {
        $entry = JournalEntry::query()->findOrFail($id);
        Gate::authorize('post', $entry);
        $posted = $this->poster->postDraft($entry, $this->actor($request), Gate::allows('postSoftClosed', JournalEntry::class), $request->optionalVersion());

        return ApiResponse::success($this->resolve(new JournalEntryResource($posted->load('lines.account')), $request));
    }

    public function reverse(ReverseEntryRequest $request, string $id): JsonResponse
    {
        $entry = JournalEntry::query()->findOrFail($id);
        Gate::authorize('reverse', $entry);

        if ($request->optionalVersion() !== null) {
            $entry->assertVersion((int) $request->optionalVersion());
        }

        $reversal = $this->poster->reverseEntry(
            $entry->id,
            new DateTimeImmutable($request->string('date')->toString()),
            $request->string('reason')->toString(),
            $this->actor($request),
            allowSoftClosed: Gate::allows('postSoftClosed', JournalEntry::class),
        );

        return ApiResponse::created($this->resolve(new JournalEntryResource($reversal->load('lines.account')), $request));
    }

    /**
     * Lines of the filtered entries as CSV (default) or XLSX; refused above the row cap.
     */
    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', JournalEntry::class);
        $format = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate()['format'] ?? 'csv';
        [$request, $custom] = $this->customFilters($request, self::CUSTOM);
        $query = JournalExport::linesFor($this->filtered(JournalEntry::query(), $custom), $request);
        $max = config('accounting.export_max_rows');
        $max = is_numeric($max) ? (int) $max : 50000;

        if ((clone $query)->count() > $max) {
            $message = Messages::get('export_too_large', ['max' => $max]);

            throw new ApiException(ErrorCode::ValidationError, $message, ['filter' => [$message]]);
        }

        $name = 'journal-'.Carbon::now()->format('Ymd-His');

        if ($format === 'xlsx') {
            return Excel::download(new JournalExport($query), $name.'.xlsx', ExcelFormat::XLSX);
        }

        $rows = $query->get();

        return response()->streamDownload(function () use ($rows): void {
            $out = fopen('php://output', 'wb');

            if ($out === false) {
                return;
            }

            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, JournalExport::HEADINGS, escape: '');

            foreach ($rows as $line) {
                fputcsv($out, JournalExport::row($line), escape: '');
            }

            fclose($out);
        }, $name.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * @param  Builder<JournalEntry>  $query
     * @param  array<string, string>  $custom
     * @return Builder<JournalEntry>
     */
    private function filtered(Builder $query, array $custom): Builder
    {
        if (isset($custom['date_from'])) {
            $query->whereDate('entry_date', '>=', $this->date('filter.date_from', $custom['date_from']));
        }

        if (isset($custom['date_to'])) {
            $query->whereDate('entry_date', '<=', $this->date('filter.date_to', $custom['date_to']));
        }

        if (isset($custom['amount_min'])) {
            $query->where('total_debit', '>=', $this->amount('filter.amount_min', $custom['amount_min']));
        }

        if (isset($custom['amount_max'])) {
            $query->where('total_debit', '<=', $this->amount('filter.amount_max', $custom['amount_max']));
        }

        foreach (['account_id' => 'filter.account_id', 'party_id' => 'filter.party_id'] as $column => $field) {
            if (isset($custom[$column])) {
                $value = $this->uuid($field, $custom[$column]);
                $query->whereIn('id', JournalLine::query()->select('entry_id')->where($column, $value));
            }
        }

        return $query;
    }
}
