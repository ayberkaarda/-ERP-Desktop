<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use App\Modules\Assistant\Exceptions\AssistantException;
use App\Modules\Identity\Contracts\CompanyAuthorizer;

final readonly class AssistantAccess
{
    public function __construct(private CompanyAuthorizer $authorizer, private CompanyContext $context) {}

    public function enabled(): void
    {
        if (! config('assistant.enabled')) {
            throw new AssistantException('ASSISTANT_DISABLED', 'The assistant is disabled.', 503);
        }
    }

    public function configured(): bool
    {
        $provider = config('assistant.provider');

        return is_string($provider) && $provider !== '' && is_array(config('ai.providers.'.$provider)) && is_string(config('assistant.model')) && config('assistant.model') !== '';
    }

    public function ready(): void
    {
        $this->enabled();
        if (! $this->configured()) {
            throw new AssistantException('ASSISTANT_NOT_CONFIGURED', 'The assistant provider and model must be configured.', 503);
        }
    }

    public function allows(User $user, string $permission): bool
    {
        return $this->authorizer->allows($user, $permission, $this->context->id());
    }

    public function authorize(User $user, string $permission = 'assistant.use'): void
    {
        $this->ready();
        $this->authorizer->forget($user->id);
        $fresh = $user->fresh();
        if ($fresh !== null && $fresh->must_change_password) {
            throw new ApiException(ErrorCode::PasswordChangeRequired);
        }
        if ($fresh === null || ! $fresh->is_active || ! $this->allows($fresh, $permission)) {
            throw new AssistantException('FORBIDDEN', 'You are not allowed to use this assistant operation.', 403);
        }
    }
}
