<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Models\JournalLine;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Maatwebsite\Excel\Concerns\FromQuery;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;

/**
 * One row per journal line of the selected entries; cells a spreadsheet would read as a formula
 * are prefixed with '.
 *
 * @implements WithMapping<JournalLine>
 */
final class JournalExport implements FromQuery, WithHeadings, WithMapping
{
    public const array HEADINGS = [
        'number', 'entry_date', 'entry_type', 'status', 'description', 'line_no', 'account_code', 'account_name',
        'debit', 'credit', 'currency_code', 'fx_amount', 'fx_rate', 'party_id', 'cost_center_id', 'project_id',
        'line_description', 'due_date', 'document_ref',
    ];

    public const array FILTERS = ['entry_type', 'status', 'period_id', 'fiscal_year_id', 'source_type'];

    private const array TRIGGERS = ['=', '+', '-', '@', "\t", "\r", "\n"];

    /**
     * @param  Builder<JournalLine>  $query
     */
    public function __construct(private readonly Builder $query) {}

    /**
     * Lines of the entries matching the standard filters and q of the request.
     *
     * @param  Builder<JournalEntry>  $entries
     * @return Builder<JournalLine>
     *
     * @throws ValidationException
     */
    public static function linesFor(Builder $entries, Request $request): Builder
    {
        $filters = $request->query('filter');

        foreach (is_array($filters) ? $filters : [] as $name => $value) {
            if (! in_array($name, self::FILTERS, true) || ! is_string($value)) {
                throw ValidationException::withMessages(["filter.{$name}" => [(string) __('validation.in', ['attribute' => "filter.{$name}"])]]);
            }

            if ($value !== '') {
                $entries->whereIn($name, explode(',', $value));
            }
        }

        $term = $request->query('q');

        if (is_string($term) && trim($term) !== '') {
            $like = '%'.addcslashes(trim($term), '%_\\').'%';
            $entries->where(fn (Builder $w) => $w->where('number', 'ilike', $like)->orWhere('description', 'ilike', $like));
        }

        return JournalLine::query()->with(['entry', 'account'])
            ->whereIn('entry_id', $entries->select('id'))
            ->join('journal_entries as je', 'je.id', '=', 'journal_lines.entry_id')
            ->orderBy('je.entry_date')->orderBy('je.number')->orderBy('journal_lines.line_no')
            ->select('journal_lines.*');
    }

    /** @return Builder<JournalLine> */
    public function query(): Builder
    {
        return $this->query;
    }

    /** @return list<string> */
    public function headings(): array
    {
        return self::HEADINGS;
    }

    /**
     * @param  JournalLine  $row
     * @return list<string>
     */
    public function map($row): array
    {
        return self::row($row);
    }

    /** @return list<string> */
    public static function row(JournalLine $line): array
    {
        $entry = $line->entry;

        return array_map(self::cell(...), [
            $entry->number,
            $entry->entry_date->format('Y-m-d'),
            $entry->entry_type->value,
            $entry->status->value,
            $entry->description,
            (string) $line->line_no,
            $line->account->code,
            $line->account->name,
            (string) $line->debit,
            (string) $line->credit,
            $line->currency_code,
            $line->fx_amount?->__toString(),
            $line->fx_rate?->__toString(),
            $line->party_id,
            $line->cost_center_id,
            $line->project_id,
            $line->description,
            $line->due_date?->format('Y-m-d'),
            $line->document_ref,
        ]);
    }

    public static function cell(?string $value): string
    {
        $value ??= '';

        return $value !== '' && in_array($value[0], self::TRIGGERS, true) ? "'".$value : $value;
    }
}
