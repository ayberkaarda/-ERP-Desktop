<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Http\Middleware;

use App\Core\Company\CompanyContext;
use App\Core\Idempotency\EnsureIdempotency;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class OperationIdempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        if (! is_string($key) || $key === '' || strlen($key) > 255) {
            throw new EDocumentException('IDEMPOTENCY_KEY_REQUIRED', 'A bounded Idempotency-Key is required.', 422);
        }
        $company = app(CompanyContext::class)->id();
        $user = (string) $request->user()?->getAuthIdentifier();
        $hash = EnsureIdempotency::fingerprint($request);
        $operation = DB::transaction(function () use ($company, $user, $key, $hash): object {
            DB::table('edocument_operations')->insertOrIgnore(['id' => (string) Str::uuid7(), 'company_id' => $company, 'user_id' => $user, 'key' => $key, 'fingerprint' => $hash, 'state' => 'new', 'lease_until' => now(), 'created_at' => now(), 'updated_at' => now()]);
            $row = DB::table('edocument_operations')->where('company_id', $company)->where('user_id', $user)->where('key', $key)->lockForUpdate()->first();
            if ($row === null) {
                throw new EDocumentException('EDOC_REQUEST_BUSY', 'Operation could not be claimed.');
            }
            if ($row->fingerprint !== $hash) {
                throw new EDocumentException('IDEMPOTENCY_KEY_REUSED', 'This key belongs to a different request.');
            }
            if ($row->state === 'complete') {
                return $row;
            }
            if ($row->state === 'processing' && now()->lt($row->lease_until)) {
                throw new EDocumentException('EDOC_REQUEST_BUSY', 'This operation is processing.');
            }
            $row->claim_token = (string) Str::uuid7();
            DB::table('edocument_operations')->where('id', $row->id)->update(['state' => 'processing', 'claim_token' => $row->claim_token, 'lease_until' => now()->addSeconds(180), 'updated_at' => now()]);

            return $row;
        });
        if ($operation->state === 'complete') {
            $data = json_decode((string) $operation->response, true, flags: JSON_THROW_ON_ERROR);

            return response()->json($data, (int) $operation->response_status);
        }
        $request->attributes->set('edoc_operation_id', (string) $operation->id);
        try {
            $response = $next($request);
            $success = $response->getStatusCode() >= 200 && $response->getStatusCode() < 300;
            DB::table('edocument_operations')->where('id', $operation->id)->where('claim_token', $operation->claim_token)->update(['state' => $success ? 'complete' : 'retryable', 'response' => $success ? $response->getContent() : null, 'response_status' => $success ? $response->getStatusCode() : null, 'updated_at' => now()]);

            return $response;
        } catch (Throwable $e) {
            DB::table('edocument_operations')->where('id', $operation->id)->where('claim_token', $operation->claim_token)->update(['state' => 'retryable', 'lease_until' => now(), 'updated_at' => now()]);
            throw $e;
        }
    }
}
