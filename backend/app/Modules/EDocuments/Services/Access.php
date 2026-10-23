<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Exceptions\EDocumentException;
use App\Modules\EDocuments\Models\Document;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

final readonly class Access
{
    public function __construct(private CompanyContext $context, private CompanyAuthorizer $authorizer) {}

    public function authorize(User $user, string $permission = 'edocuments.view', ?Document $document = null): void
    {
        if (config('edocuments.driver') !== 'sandbox') {
            throw new EDocumentException('EDOC_PROVIDER_UNAVAILABLE', 'Only the configured sandbox provider is available.', 503);
        }
        $fresh = $user->fresh();
        if ($fresh === null || ! $fresh->is_active) {
            throw new ApiException(ErrorCode::UserDeactivated);
        }
        if ($fresh->must_change_password) {
            throw new ApiException(ErrorCode::PasswordChangeRequired);
        }
        $this->authorizer->forget($fresh->id);
        foreach (array_unique(['edocuments.view', $permission]) as $name) {
            if (! $this->authorizer->allows($fresh, $name, $this->context->id())) {
                abort(403);
            }
        }
        if ($document !== null && $document->direction === 'outgoing') {
            $this->source($fresh, $document->kind);
        }
    }

    public function source(User $user, DocumentKind $kind): void
    {
        $user = $user->fresh() ?? abort(401);
        $this->authorizer->forget($user->id);
        if (! $this->authorizer->allows($user, $kind->permission(), $this->context->id())) {
            abort(403);
        }
    }
}
