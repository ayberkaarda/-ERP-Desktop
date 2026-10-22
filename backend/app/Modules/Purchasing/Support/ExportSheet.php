<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Support;

use Maatwebsite\Excel\Concerns\FromArray;
use Maatwebsite\Excel\Concerns\WithCustomValueBinder;
use Maatwebsite\Excel\Concerns\WithHeadings;
use PhpOffice\PhpSpreadsheet\Cell\Cell;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Cell\DefaultValueBinder;

/**
 * XLSX sheet of an already guarded table; every cell is text so decimals keep their digits.
 */
final class ExportSheet extends DefaultValueBinder implements FromArray, WithCustomValueBinder, WithHeadings
{
    /**
     * @param  list<string>  $headings
     * @param  list<list<string>>  $rows
     */
    public function __construct(
        private readonly array $headings,
        private readonly array $rows,
    ) {}

    /** @return list<list<string>> */
    public function array(): array
    {
        return $this->rows;
    }

    /** @return list<string> */
    public function headings(): array
    {
        return $this->headings;
    }

    public function bindValue(Cell $cell, mixed $value): bool
    {
        $cell->setValueExplicit(is_scalar($value) ? (string) $value : '', DataType::TYPE_STRING);

        return true;
    }
}
