<?php

declare(strict_types=1);

namespace App\Modules\Identity;

use App\Core\Company\MembershipChecker;
use App\Core\Modules\ModuleServiceProvider;
use App\Models\User;
use App\Modules\Identity\Broadcasting\CompanyPresenceChannel;
use App\Modules\Identity\Broadcasting\UserChannel;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Identity\Http\Middleware\EnforceAccountState;
use App\Modules\Identity\Http\Middleware\EnsurePasswordChanged;
use App\Modules\Identity\Listeners\CreateDefaultRoles;
use App\Modules\Identity\Models\Activity;
use App\Modules\Identity\Models\PersonalAccessToken;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Models\SessionLog;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Models\UserSession;
use App\Modules\Identity\Policies\ActivityPolicy;
use App\Modules\Identity\Policies\RolePolicy;
use App\Modules\Identity\Policies\SessionLogPolicy;
use App\Modules\Identity\Policies\UserDevicePolicy;
use App\Modules\Identity\Policies\UserPolicy;
use App\Modules\Identity\Policies\UserSessionPolicy;
use App\Modules\Identity\Services\IdentityMembershipChecker;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Identity\Services\PermissionResolver;
use App\Modules\Organization\Events\CompanyCreated;
use Illuminate\Contracts\Http\Kernel as HttpKernelContract;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\Sanctum;
use PragmaRX\Google2FA\Google2FA;

final class IdentityServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/config/identity.php', 'identity');

        $this->app->singleton(PermissionCatalog::class);
        $this->app->alias(PermissionCatalog::class, PermissionRegistry::class);

        $this->app->scoped(PermissionResolver::class);
        $this->app->alias(PermissionResolver::class, CompanyAuthorizer::class);

        $this->app->bind(MembershipChecker::class, IdentityMembershipChecker::class);
        $this->app->singleton(Google2FA::class);
    }

    public function boot(): void
    {
        $this->bootModule();

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
        Relation::morphMap(['user' => User::class, 'role' => Role::class]);

        // Super admins pass every ability; invariants that must hold for them live in services.
        Gate::before(static fn (mixed $user): ?bool => $user instanceof User && $user->is_super_admin && $user->is_active ? true : null);

        Gate::policy(User::class, UserPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
        Gate::policy(Activity::class, ActivityPolicy::class);
        Gate::policy(SessionLog::class, SessionLogPolicy::class);
        Gate::policy(UserSession::class, UserSessionPolicy::class);
        Gate::policy(UserDevice::class, UserDevicePolicy::class);

        Event::listen(CompanyCreated::class, CreateDefaultRoles::class);

        $this->app->make(Router::class)->aliasMiddleware('password.changed', EnsurePasswordChanged::class);

        // The HTTP kernel singleton owns the middleware groups and re-syncs them to the router.
        $this->app->make(HttpKernelContract::class)->appendMiddlewareToGroup('api', EnforceAccountState::class);

        $this->bootBroadcasting();
    }

    private function bootBroadcasting(): void
    {
        if (! $this->app->routesAreCached()) {
            Broadcast::routes(['prefix' => 'api/v1', 'middleware' => ['api', 'auth:sanctum']]);
        }

        Broadcast::channel('user.{id}', UserChannel::class);
        Broadcast::channel('company.{id}.online', CompanyPresenceChannel::class);
    }
}
