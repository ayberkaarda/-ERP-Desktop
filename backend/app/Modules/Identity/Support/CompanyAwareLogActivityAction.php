<?php

declare(strict_types=1);

namespace App\Modules\Identity\Support;

use App\Core\Company\CompanyContext;
use App\Core\Company\CompanyGuard;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Spatie\Activitylog\Actions\LogActivityAction;

/**
 * Stamps audit entries with the company they belong to (active company, else the subject's
 * company) plus request ip and user agent. Account-level entries without any company are
 * stored with company_id null.
 */
class CompanyAwareLogActivityAction extends LogActivityAction
{
    protected function save(Model $activity): void
    {
        $active = app(CompanyContext::class)->idOrNull();

        if ($activity->getAttribute('company_id') === null) {
            $activity->setAttribute('company_id', $active ?? $this->subjectCompany($activity));
        }

        $this->addRequestContext($activity);

        $company = $activity->getAttribute('company_id');

        if ($company === null) {
            // No company to scope to: skip the company write hooks, which require one.
            $activity->saveQuietly();

            return;
        }

        if ($company !== $active) {
            CompanyGuard::bypass(static fn (): bool => $activity->save());

            return;
        }

        $activity->save();
    }

    private function subjectCompany(Model $activity): ?string
    {
        if ($activity->getAttribute('subject_type') === 'company') {
            $id = $activity->getAttribute('subject_id');

            return is_string($id) ? $id : null;
        }

        $subject = $activity->relationLoaded('subject') ? $activity->getRelation('subject') : null;
        $company = $subject instanceof Model ? $subject->getAttribute('company_id') : null;

        return is_string($company) ? $company : null;
    }

    private function addRequestContext(Model $activity): void
    {
        if (app()->runningInConsole() && ! app()->runningUnitTests()) {
            return;
        }

        $request = request();

        $properties = $activity->getAttribute('properties');
        $properties = $properties instanceof Collection ? $properties : new Collection;

        $activity->setAttribute('properties', $properties->union([
            'ip' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
        ]));
    }
}
