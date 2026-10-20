<?php

declare(strict_types=1);

namespace App\Core\Company\Http;

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware alias `company`: activates the company named by X-Company-Id for a member.
 */
final class ResolveCompany
{
    public const string HEADER = 'X-Company-Id';

    public function __construct(
        private readonly CompanyContext $context,
        private readonly MembershipChecker $membership,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            throw new AuthenticationException;
        }

        $companyId = $request->header(self::HEADER);

        if (! is_string($companyId) || ! Str::isUuid($companyId)) {
            throw new ApiException(ErrorCode::CompanyRequired);
        }

        $userId = $user->getAuthIdentifier();

        if ((! is_string($userId) && ! is_int($userId))
            || ! $this->membership->isMember((string) $userId, $companyId)) {
            throw new ApiException(ErrorCode::CompanyForbidden);
        }

        $this->context->set($companyId);

        return $next($request);
    }
}
