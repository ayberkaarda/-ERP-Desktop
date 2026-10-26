<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Reports\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Reports\Services\TreasuryReports;
use App\Modules\Treasury\Reports\Support\ExportSheet;
use App\Modules\Treasury\Reports\Support\ReadSnapshot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Maatwebsite\Excel\Excel as ExcelFormat;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class TreasuryReportController
{
    public function show(Request $request, string $report, TreasuryReports $reports): JsonResponse
    {
        $input = $this->input($request, $report);
        $page = (int) ($input['page'] ?? 1);
        $perPage = (int) ($input['per_page'] ?? 100);
        $table = ReadSnapshot::run(fn () => $reports->table($report, $input, ($page - 1) * $perPage, $perPage));

        return ApiResponse::success($table->rows, ['report' => $report, 'filters' => $input, ...$table->meta,
            'pagination' => ['current_page' => $page, 'per_page' => $perPage, 'total' => $table->total, 'last_page' => max(1, (int) ceil($table->total / $perPage))]]);
    }

    public function export(Request $request, string $report, TreasuryReports $reports): StreamedResponse|BinaryFileResponse
    {
        $input = $this->input($request, $report);
        $table = ReadSnapshot::run(fn () => $reports->table($report, $input, 0, 50000, true));
        $columns = $table->rows === [] ? ['result'] : array_keys($table->rows[0]);
        $rows = [];
        foreach ($table->rows as $row) {
            $cells = [];
            foreach ($columns as $column) {
                $value = is_scalar($row[$column] ?? null) ? (string) $row[$column] : '';
                $cells[] = preg_match('/^-?\d+(\.\d+)?$/D', $value) !== 1 && preg_match('/^[=+\-@\t\r]/', ltrim($value, ' ')) === 1 ? "'".$value : $value;
            }
            $rows[] = $cells;
        }
        $name = 'treasury-'.$report.'-'.now()->format('Ymd-His');
        if (($input['format'] ?? 'csv') === 'xlsx') {
            return Excel::download(new ExportSheet($columns, $rows), $name.'.xlsx', ExcelFormat::XLSX);
        }

        return response()->streamDownload(static function () use ($columns, $rows): void {
            $stream = fopen('php://output', 'wb');
            if ($stream === false) {
                return;
            }
            fwrite($stream, "\xEF\xBB\xBF");
            fputcsv($stream, $columns, escape: '');
            foreach ($rows as $row) {
                fputcsv($stream, $row, escape: '');
            }
            fclose($stream);
        }, $name.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** @return array<string, mixed> */
    private function input(Request $request, string $report): array
    {
        Extension::authorize('treasury.reports.view');
        if ($report === 'receivables-ageing' || $report === 'payables-ageing') {
            Extension::authorize($report === 'receivables-ageing' ? 'sales.invoices.view' : 'purchasing.invoices.view');
        }

        return $request->validate(['date_from' => 'sometimes|date_format:Y-m-d', 'date_to' => 'sometimes|date_format:Y-m-d',
            'as_of' => 'sometimes|date_format:Y-m-d', 'account_id' => 'sometimes|uuid', 'party_id' => 'sometimes|uuid', 'currency_code' => 'sometimes|regex:/^[A-Z]{3}$/',
            'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:500', 'format' => 'sometimes|in:csv,xlsx']);
    }
}
