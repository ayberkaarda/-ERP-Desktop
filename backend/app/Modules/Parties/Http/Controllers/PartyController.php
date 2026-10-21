<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ApiResponse;
use App\Core\Http\ErrorCode;
use App\Modules\Parties\Http\Requests\PartyRequest;
use App\Modules\Parties\Http\Requests\VersionRequest;
use App\Modules\Parties\Http\Resources\DuplicateResource;
use App\Modules\Parties\Http\Resources\PartyResource;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Services\DuplicateFinder;
use App\Modules\Parties\Services\PartyService;
use App\Modules\Parties\Support\ExportSnapshot;
use App\Modules\Parties\Support\Messages;
use App\Modules\Parties\Support\PartyExport;
use App\Modules\Parties\Support\PartyFilters;
use App\Modules\Parties\Validation\TaxNumber;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Maatwebsite\Excel\Excel as ExcelFormat;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class PartyController
{
    public const int EXPORT_MAX_ROWS = 50000;

    public function __construct(private readonly PartyService $parties) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Party::class);

        return ApiResponse::paginated(PartyFilters::paginate($request), PartyResource::class);
    }

    public function store(PartyRequest $request): JsonResponse
    {
        Gate::authorize('create', Party::class);
        $party = $this->parties->create($request->validated());

        return ApiResponse::created((new PartyResource($party))->resolve($request));
    }

    public function show(Request $request, string $party): JsonResponse
    {
        $model = Party::query()->with(['addresses', 'contacts', 'bankAccounts'])->findOrFail($party);
        Gate::authorize('view', $model);

        return ApiResponse::success((new PartyResource($model))->resolve($request));
    }

    public function update(PartyRequest $request, string $party): JsonResponse
    {
        $model = $request->existing() ?? Party::query()->findOrFail($party);
        Gate::authorize('update', $model);
        $model = $this->parties->update($model, $request->validated());

        return ApiResponse::success((new PartyResource($model))->resolve($request));
    }

    /**
     * 204 when deleted; 200 with the party and meta.action = deactivated when it is still in use.
     */
    public function destroy(VersionRequest $request, string $party): JsonResponse
    {
        $model = Party::query()->findOrFail($party);
        Gate::authorize('delete', $model);
        $deactivated = $this->parties->delete($model, $request->integer('version'));

        if ($deactivated === null) {
            return ApiResponse::noContent();
        }

        return ApiResponse::success((new PartyResource($deactivated))->resolve($request), [
            'action' => 'deactivated',
            'message' => Messages::get('deactivated_in_use'),
        ]);
    }

    /**
     * GET /parties/duplicates?tax_number=&name=&country=&exclude_id=
     */
    public function duplicates(Request $request, DuplicateFinder $finder): JsonResponse
    {
        Gate::authorize('viewAny', Party::class);

        $input = Validator::make($request->query(), [
            'tax_number' => ['nullable', 'string', 'max:'.TaxNumber::MAX_FOREIGN_LENGTH],
            'name' => ['nullable', 'string', 'max:255'],
            'country' => ['nullable', 'string', 'regex:/\A[A-Za-z]{2}\z/'],
            'exclude_id' => ['nullable', 'uuid'],
        ])->validate();

        $taxNumber = is_string($input['tax_number'] ?? null) ? TaxNumber::normalize($input['tax_number'], is_string($input['country'] ?? null) ? $input['country'] : 'TR') : null;
        $name = is_string($input['name'] ?? null) ? $input['name'] : null;

        if (($taxNumber === null || $taxNumber === '') && ($name === null || trim($name) === '')) {
            $message = Messages::get('duplicate_criteria');

            throw new ApiException(ErrorCode::ValidationError, $message, ['tax_number' => [$message], 'name' => [$message]]);
        }

        $exclude = is_string($input['exclude_id'] ?? null) ? $input['exclude_id'] : null;

        return ApiResponse::success(DuplicateResource::collection($finder->find($taxNumber, $name, $exclude))->resolve($request));
    }

    /**
     * Same filters, search and sort as the list; refuses (422) above the row cap instead of
     * truncating. The cap check and the read share one REPEATABLE READ snapshot; for CSV it is
     * repeated inside the streamed snapshot, which then writes only an error line if the cap is
     * exceeded by rows added after the first check. Rows are read lazily with only the exported
     * columns, under the company of the request.
     */
    public function export(Request $request, ExportSnapshot $snapshot): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', Party::class);

        $format = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate()['format'] ?? 'csv';
        $query = PartyFilters::query($request)->select(PartyExport::COLUMNS);
        $max = self::exportMaxRows();
        $message = Messages::get('export_too_large', ['max' => $max]);
        $name = 'parties-'.Carbon::now()->format('Ymd-His');

        if ($format === 'xlsx') {
            return $snapshot->run(function () use ($query, $max, $message, $name): BinaryFileResponse {
                self::assertWithinCap($query, $max, $message);

                return Excel::download(new PartyExport($query), $name.'.xlsx', ExcelFormat::XLSX);
            });
        }

        self::assertWithinCap($query, $max, $message);
        $company = app(CompanyContext::class)->id();

        return response()->streamDownload(function () use ($query, $max, $message, $company, $snapshot): void {
            $out = fopen('php://output', 'wb');

            if ($out === false) {
                return;
            }

            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, PartyExport::HEADINGS, escape: '');

            app(CompanyContext::class)->runAs($company, fn () => $snapshot->run(function () use ($out, $query, $max, $message): void {
                if ((clone $query)->count() > $max) {
                    fputcsv($out, [PartyExport::cell($message)], escape: '');

                    return;
                }

                foreach ($query->lazy(1000) as $party) {
                    fputcsv($out, PartyExport::row($party), escape: '');
                }
            }));

            fclose($out);
        }, $name.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public static function exportMaxRows(): int
    {
        $max = config('parties.export_max_rows');

        return is_numeric($max) ? (int) $max : self::EXPORT_MAX_ROWS;
    }

    /**
     * @param  Builder<Party>  $query
     */
    private static function assertWithinCap(Builder $query, int $max, string $message): void
    {
        if ((clone $query)->count() > $max) {
            throw new ApiException(ErrorCode::ValidationError, $message, ['filter' => [$message]]);
        }
    }
}
