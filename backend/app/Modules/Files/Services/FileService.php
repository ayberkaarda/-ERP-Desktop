<?php

declare(strict_types=1);

namespace App\Modules\Files\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Files\Contracts\FileScanner;
use App\Modules\Files\Models\File;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Filesystem\Factory as Filesystems;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class FileService
{
    public const int MAX_BYTES = 25 * 1024 * 1024;

    public function __construct(
        private readonly Filesystems $storage,
        private readonly FileScanner $scanner,
        private readonly CompanyContext $company,
        private readonly string $disk = 'local',
        private readonly int $urlTtlMinutes = 5,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function store(UploadedFile $upload, Authenticatable $actor, ?string $attachableType = null, ?string $attachableId = null): File
    {
        if (! $upload->isValid()) {
            $tooBig = in_array($upload->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);

            throw $tooBig
                ? new ApiException(ErrorCode::FileTooLarge)
                : ValidationException::withMessages(['file' => [__('files::messages.upload_failed')]]);
        }

        $size = (int) $upload->getSize();

        if ($size > self::MAX_BYTES) {
            throw new ApiException(ErrorCode::FileTooLarge);
        }
        if ($size === 0) {
            throw ValidationException::withMessages(['file' => [__('files::messages.empty')]]);
        }

        $name = FileNameSanitizer::clean($upload->getClientOriginalName());
        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $localPath = $upload->getRealPath();

        if ($localPath === false) {
            throw ValidationException::withMessages(['file' => [__('files::messages.upload_failed')]]);
        }

        // Content decides, not the client supplied mime or extension alone.
        $sniffed = (new \finfo(FILEINFO_MIME_TYPE))->file($localPath);
        $mime = $sniffed === false ? null : AllowedFileTypes::mimeFor($extension, $sniffed);

        if ($mime === null) {
            throw new ApiException(ErrorCode::UnsupportedFileType);
        }

        $scan = $this->scanner->scan($localPath, $name);

        if (! $scan->clean) {
            throw new ApiException(ErrorCode::UnsupportedFileType, __('files::messages.infected'));
        }

        [$type, $id] = $this->resolveAttachable($attachableType, $attachableId);

        $companyId = $this->company->id();
        $path = sprintf('companies/%s/%s/%s.%s', $companyId, now()->format('Y/m'), Str::uuid7(), $extension);
        $hash = hash_file('sha256', $localPath);
        $stream = fopen($localPath, 'rb');

        if ($hash === false || $stream === false) {
            throw ValidationException::withMessages(['file' => [__('files::messages.upload_failed')]]);
        }

        try {
            $this->storage->disk($this->disk)->writeStream($path, $stream);
        } finally {
            fclose($stream);
        }

        $actorId = $actor->getAuthIdentifier();

        try {
            return File::query()->create([
                'disk' => $this->disk,
                'path' => $path,
                'original_name' => $name,
                'mime' => $mime,
                'size' => $size,
                'sha256' => $hash,
                'uploaded_by' => is_string($actorId) ? $actorId : null,
                'attachable_type' => $type,
                'attachable_id' => $id,
            ]);
        } catch (Throwable $e) {
            $this->storage->disk($this->disk)->delete($path);

            throw $e;
        }
    }

    /**
     * Soft delete only; the blob stays until a retention job purges it.
     */
    public function delete(File $file): void
    {
        $file->delete();
    }

    public function download(File $file): Response
    {
        $disk = $this->storage->disk($file->disk);
        $headers = [
            'Content-Type' => $file->mime,
            'X-Content-Type-Options' => 'nosniff',
        ];

        if (config("filesystems.disks.{$file->disk}.driver") === 's3' && method_exists($disk, 'temporaryUrl')) {
            $url = $disk->temporaryUrl($file->path, now()->addMinutes($this->urlTtlMinutes), [
                'ResponseContentType' => $file->mime,
                'ResponseContentDisposition' => $this->disposition($file->original_name),
            ]);

            return new RedirectResponse($url, 302, ['Cache-Control' => 'no-store']);
        }

        if (! $disk->exists($file->path) || ! method_exists($disk, 'download')) {
            throw new ApiException(ErrorCode::NotFound);
        }

        /** @var Response */
        return $disk->download($file->path, $file->original_name, $headers);
    }

    /**
     * @return array{0: string|null, 1: string|null}
     *
     * @throws ValidationException
     */
    private function resolveAttachable(?string $type, ?string $id): array
    {
        if ($type === null && $id === null) {
            return [null, null];
        }

        $fail = fn (): ValidationException => ValidationException::withMessages([
            'attachable_id' => [__('files::messages.attachable_invalid')],
        ]);

        if ($type === null || $id === null) {
            throw $fail();
        }

        $class = Model::getActualClassNameForMorph($type);

        // Only classes that opted in through the contract can receive files.
        if (! class_exists($class) || ! is_subclass_of($class, Attachable::class) || ! is_subclass_of($class, Model::class)) {
            throw $fail();
        }

        $target = $class::query()->find($id);

        if (! $target instanceof Model) {
            throw $fail();
        }

        $owner = $target->getAttribute('company_id');
        if ($owner !== null && $owner !== $this->company->id()) {
            throw $fail();
        }

        return [$target->getMorphClass(), (string) $target->getKey()];
    }

    private function disposition(string $name): string
    {
        $ascii = str_replace(['"', '\\', '%'], '_', Str::ascii($name));

        return sprintf('attachment; filename="%s"; filename*=UTF-8\'\'%s', $ascii, rawurlencode($name));
    }
}
