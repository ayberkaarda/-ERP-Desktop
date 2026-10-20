<?php

declare(strict_types=1);

namespace App\Modules\Files\Http;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects uploads PHP already refused (no temp file) before the idempotency middleware
 * tries to fingerprint them.
 */
final class ValidateUploadBeforeIdempotency
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $file = $request->file('file');

        if ($file === null) {
            return $next($request);
        }

        if (! $file instanceof UploadedFile) {
            throw ValidationException::withMessages(['file' => [__('files::messages.upload_failed')]]);
        }

        if (! $file->isValid()) {
            if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                throw new ApiException(ErrorCode::FileTooLarge);
            }

            throw ValidationException::withMessages(['file' => [__('files::messages.upload_failed')]]);
        }

        return $next($request);
    }
}
