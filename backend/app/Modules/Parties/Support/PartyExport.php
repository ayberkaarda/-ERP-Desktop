<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

use App\Modules\Parties\Models\Party;
use Illuminate\Database\Eloquent\Builder;
use Maatwebsite\Excel\Concerns\FromQuery;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;

/**
 * Party rows for CSV/XLSX; cells that a spreadsheet would read as a formula are prefixed with '.
 *
 * @implements WithMapping<Party>
 */
final class PartyExport implements FromQuery, WithHeadings, WithMapping
{
    public const array HEADINGS = [
        'code', 'name', 'legal_name', 'type', 'roles', 'tax_office', 'tax_number', 'country',
        'default_currency_code', 'risk_limit', 'risk_currency_code', 'is_active', 'tags', 'created_at',
    ];

    private const array TRIGGERS = ['=', '+', '-', '@', "\t", "\r", "\n"];

    /**
     * @param  Builder<Party>  $query
     */
    public function __construct(private readonly Builder $query) {}

    /** @return Builder<Party> */
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
     * @param  Party  $row
     * @return list<string>
     */
    public function map($row): array
    {
        return self::row($row);
    }

    /** @return list<string> */
    public static function row(Party $party): array
    {
        return array_map(self::cell(...), [
            $party->code,
            $party->name,
            $party->legal_name,
            $party->type->value,
            implode(',', $party->roles),
            $party->tax_office,
            $party->tax_number,
            $party->country,
            $party->default_currency_code,
            $party->risk_limit?->__toString(),
            $party->risk_currency_code,
            $party->is_active ? 'true' : 'false',
            implode(',', $party->tags),
            $party->created_at?->toIso8601String(),
        ]);
    }

    public static function cell(?string $value): string
    {
        if ($value === null || $value === '') {
            return '';
        }

        return in_array($value[0], self::TRIGGERS, true) ? "'".$value : $value;
    }
}
