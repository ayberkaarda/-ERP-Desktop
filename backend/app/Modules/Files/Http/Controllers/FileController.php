<?php

declare(strict_types=1);

namespace App\Modules\Files\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Files\Http\Requests\UploadFileRequest;
use App\Modules\Files\Http\Resources\FileResource;
use App\Modules\Files\Models\File;
use App\Modules\Files\Services\FileService;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

final class FileController extends Controller
{
    public function __construct(private readonly FileService $files) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', File::class);

        return ApiResponse::paginated(
            ListQuery::for(
                File::query(),
                $request,
                ['created_at', 'original_name', 'size'],
                ['attachable_type', 'attachable_id', 'mime'],
                ['original_name'],
            ),
            FileResource::class,
        );
    }

    public function store(UploadFileRequest $request): JsonResponse
    {
        Gate::authorize('create', File::class);

        $upload = $request->file('file');

        if (! $upload instanceof UploadedFile) {
            throw ValidationException::withMessages(['file' => [__('validation.required', ['attribute' => 'file'])]]);
        }

        $file = $this->files->store(
            $upload,
            $this->actor($request),
            $request->string('attachable_type')->toString() ?: null,
            $request->string('attachable_id')->toString() ?: null,
        );

        return ApiResponse::created((new FileResource($file))->resolve());
    }

    public function show(string $id): JsonResponse
    {
        $file = File::query()->findOrFail($id);
        Gate::authorize('view', $file);

        return ApiResponse::success((new FileResource($file))->resolve());
    }

    public function download(string $id): Response
    {
        $file = File::query()->findOrFail($id);
        Gate::authorize('view', $file);

        return $this->files->download($file);
    }

    public function destroy(string $id): JsonResponse
    {
        $file = File::query()->findOrFail($id);
        Gate::authorize('delete', $file);

        $this->files->delete($file);

        return ApiResponse::noContent();
    }

    private function actor(Request $request): Authenticatable
    {
        $user = $request->user();

        return $user instanceof Authenticatable ? $user : abort(401);
    }
}
