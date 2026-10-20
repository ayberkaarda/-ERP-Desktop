<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Services;

use App\Core\Company\MembershipChecker;
use App\Modules\Workflow\Contracts\ApproverResolver;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;

final class SpatieApproverResolver implements ApproverResolver
{
    public function __construct(private readonly MembershipChecker $membership) {}

    public function resolve(string $companyId, string $type, string $reference): array
    {
        if ($type === 'user') {
            return Str::isUuid($reference) && $this->membership->isMember($reference, $companyId) ? [$reference] : [];
        }

        if ($type !== 'role' || ! class_exists(Role::class)) {
            return [];
        }

        $roleClass = config('permission.models.role', Role::class);
        if (! is_string($roleClass) || ! is_subclass_of($roleClass, Model::class)) {
            return [];
        }

        $teamKey = config('permission.column_names.team_foreign_key', 'team_id');
        $pivot = config('permission.table_names.model_has_roles', 'model_has_roles');
        $modelKey = config('permission.column_names.model_morph_key', 'model_id');
        if (! is_string($teamKey) || ! is_string($pivot) || ! is_string($modelKey)) {
            return [];
        }

        $roles = $roleClass::query()->where('name', $reference)->where($teamKey, $companyId)->pluck('id');
        $userClass = config('auth.providers.users.model');
        if (! is_string($userClass) || ! is_subclass_of($userClass, Model::class)) {
            return [];
        }

        $morph = (new $userClass)->getMorphClass();
        $ids = DB::table($pivot)->whereIn('role_id', $roles)
            ->where($teamKey, $companyId)->where('model_type', $morph)->pluck($modelKey);
        $result = [];
        foreach ($ids as $id) {
            if (is_string($id) && Str::isUuid($id) && $this->membership->isMember($id, $companyId)) {
                $result[] = $id;
            }
        }

        return array_values(array_unique($result));
    }
}
