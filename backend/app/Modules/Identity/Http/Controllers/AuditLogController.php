<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Core\Http\ListQuery;
use App\Modules\Identity\Http\Resources\ActivityResource;
use App\Modules\Identity\Models\Activity;
use App\Modules\Identity\Services\AuditQuery;
use App\Modules\Identity\Support\AuditExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Maatwebsite\Excel\Excel as ExcelFormat;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class AuditLogController
{
    public function __construct(private readonly AuditQuery $audit) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Activity::class);

        return ApiResponse::paginated(
            ListQuery::for($request->has('sort') ? $this->audit->base($request) : $this->audit->base($request)->orderByDesc('created_at'), $request, AuditQuery::SORTS, AuditQuery::FILTERS, ['description']),
            ActivityResource::class,
        );
    }

    /**
     * Same filters as the list; refuses (422) instead of silently truncating above the row cap.
     */
    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', Activity::class);

        $format = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate()['format'] ?? 'csv';
        $query = $this->audit->withFilters($this->audit->base($request), $request);
        $max = config('identity.audit_export.max_rows', 50000);
        $max = is_numeric($max) ? (int) $max : 50000;

        if ((clone $query)->count() > $max) {
            throw new ApiException(ErrorCode::ValidationError, __('identity::audit.export_too_large', ['max' => $max]), [
                'filter' => [__('identity::audit.export_too_large', ['max' => $max])],
            ]);
        }

        $name = 'audit-'.Carbon::now()->format('Ymd-His');

        if ($format === 'xlsx') {
            return Excel::download(new AuditExport($query), $name.'.xlsx', ExcelFormat::XLSX);
        }

        // Materialise inside the request: the company scope must not be evaluated after it ends.
        $rows = $query->get();

        return response()->streamDownload(function () use ($rows): void {
            $out = fopen('php://output', 'wb');

            if ($out === false) {
                return;
            }

            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, AuditExport::HEADINGS, escape: '');

            foreach ($rows as $activity) {
                fputcsv($out, AuditExport::row($activity), escape: '');
            }

            fclose($out);
        }, $name.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
