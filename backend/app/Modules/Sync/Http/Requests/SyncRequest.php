<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Requests;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\SyncConfig;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Request-level checks shared by pull and push, in protocol order: schema_version first
 * (SYNC_SCHEMA_MISMATCH), then the batch size (SYNC_BATCH_TOO_LARGE), then the body shape.
 */
abstract class SyncRequest extends FormRequest
{
    abstract protected function batchKey(): string;

    abstract protected function batchLimit(SyncConfig $config): int;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $config = SyncConfig::fromConfig(config());
        $version = $this->input('schema_version');

        if (is_int($version) && ! $config->supportsSchema($version)) {
            throw new ApiException(ErrorCode::SyncSchemaMismatch);
        }

        $batch = $this->input($this->batchKey());

        if (is_array($batch) && count($batch) > $this->batchLimit($config)) {
            throw new ApiException(ErrorCode::SyncBatchTooLarge);
        }
    }
}
