<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Support;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Accounting\Support\JournalExport;
use App\Modules\Accounting\Support\Messages;
use Illuminate\Support\Carbon;
use Maatwebsite\Excel\Excel as ExcelFormat;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CSV (UTF-8 with BOM) or XLSX download of a report table through maatwebsite/excel, like the
 * other exports of the module: at most accounting.export_max_rows rows (422 above), and text cells
 * a spreadsheet would read as a formula are prefixed with '. Plain decimal numbers stay as they are.
 */
final class ReportExporter
{
    public static function maxRows(): int
    {
        $max = config('accounting.export_max_rows');

        return is_numeric($max) ? (int) $max : 50000;
    }

    public static function assertWithinCap(int $rows): void
    {
        $max = self::maxRows();

        if ($rows > $max) {
            $message = Messages::get('export_too_large', ['max' => $max]);

            throw new ApiException(ErrorCode::ValidationError, $message, ['filter' => [$message]]);
        }
    }

    public static function cell(string|int|null $value): string
    {
        $value = $value === null ? '' : (string) $value;

        return preg_match('/^-?\d+(\.\d+)?$/', $value) === 1 ? $value : JournalExport::cell($value);
    }

    /**
     * @param  list<string>  $headings
     * @param  list<list<string|int|null>>  $rows
     */
    public static function download(string $name, string $format, array $headings, array $rows): StreamedResponse|BinaryFileResponse
    {
        $file = $name.'-'.Carbon::now()->format('Ymd-His');
        $guarded = array_map(static fn (array $row): array => array_map(self::cell(...), $row), $rows);

        if ($format === 'xlsx') {
            return Excel::download(new ReportSheet($headings, $guarded), $file.'.xlsx', ExcelFormat::XLSX);
        }

        return response()->streamDownload(static function () use ($headings, $guarded): void {
            $out = fopen('php://output', 'wb');

            if ($out === false) {
                return;
            }

            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, $headings, escape: '');

            foreach ($guarded as $row) {
                fputcsv($out, $row, escape: '');
            }

            fclose($out);
        }, $file.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
