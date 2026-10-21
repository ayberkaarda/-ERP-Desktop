<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

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
use App\Modules\Parties\Support\Messages;
use App\Modules\Parties\Support\PartyExport;
use App\Modules\Parties\Support\PartyFilters;
use App\Modules\Parties\Validation\TaxNumber;
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
            'country' => ['nullable', 'string', 'regex:/^[A-Za-z]{2}$/'],
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
     * Same filters, search and sort as the list; refuses (422) above the row cap instead of truncating.
     */
    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', Party::class);

        $format = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate()['format'] ?? 'csv';
        $query = PartyFilters::query($request);

        if ((clone $query)->count() > self::EXPORT_MAX_ROWS) {
            $message = Messages::get('export_too_large', ['max' => self::EXPORT_MAX_ROWS]);

            throw new ApiException(ErrorCode::ValidationError, $message, ['filter' => [$message]]);
        }

        $name = 'parties-'.Carbon::now()->format('Ymd-His');

        if ($format === 'xlsx') {
            return Excel::download(new PartyExport($query), $name.'.xlsx', ExcelFormat::XLSX);
        }

        // Materialize inside the request: the company scope must not be evaluated after it ends.
        $rows = $query->get();

        return response()->streamDownload(function () use ($rows): void {
            $out = fopen('php://output', 'wb');

            if ($out === false) {
                return;
            }

            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, PartyExport::HEADINGS, escape: '');

            foreach ($rows as $party) {
                fputcsv($out, PartyExport::row($party), escape: '');
            }

            fclose($out);
        }, $name.'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
