<?php

declare(strict_types=1);

namespace App\Modules\Settings\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Models\Setting;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class SettingsService implements SettingsReader
{
    private const int TTL_SECONDS = 3600;

    public function __construct(
        private readonly SettingsRegistry $registry,
        private readonly CompanyContext $company,
        private readonly ConnectionInterface $db,
    ) {}

    /**
     * Dropped after commit so a concurrent reader cannot re-cache pre-commit values.
     */
    public static function forget(string $companyId): void
    {
        Cache::forget(self::cacheKey($companyId));
        DB::afterCommit(static fn () => Cache::forget(self::cacheKey($companyId)));
    }

    public function get(string $key): mixed
    {
        $definition = $this->registry->findOrFail($key);
        $stored = $this->stored();

        return array_key_exists($key, $stored) ? $definition->type->cast($stored[$key]) : $definition->default;
    }

    /**
     * Definitions the actor may read, with their effective values.
     *
     * @return list<array{definition: SettingDefinition, value: mixed, is_default: bool}>
     */
    public function visibleTo(Authenticatable $actor, ?string $group = null): array
    {
        $stored = $this->stored();
        $rows = [];

        foreach ($this->registry->all() as $key => $definition) {
            if ($group !== null && $definition->group !== $group) {
                continue;
            }
            if ($definition->readPermission !== null && ! $this->can($actor, $definition->readPermission)) {
                continue;
            }

            $has = array_key_exists($key, $stored);
            $rows[] = [
                'definition' => $definition,
                'value' => $has ? $definition->type->cast($stored[$key]) : $definition->default,
                'is_default' => ! $has,
            ];
        }

        return $rows;
    }

    /**
     * Sets values; null resets a key to its default.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws ValidationException
     * @throws ApiException
     */
    public function update(array $changes, Authenticatable $actor): void
    {
        $errors = [];
        $clean = [];

        foreach ($changes as $key => $value) {
            $definition = $this->registry->find((string) $key);

            if ($definition === null) {
                $errors["settings.{$key}"] = [__('settings::messages.unknown_key')];

                continue;
            }

            if ($definition->updatePermission !== null && ! $this->can($actor, $definition->updatePermission)) {
                throw new ApiException(ErrorCode::Forbidden);
            }

            if ($value === null) {
                $clean[$definition->key] = null;

                continue;
            }

            $validator = Validator::make(['value' => $value], ['value' => $definition->validationRules()])
                ->setAttributeNames(['value' => $definition->key]);

            if ($validator->fails()) {
                $errors["settings.{$key}"] = array_values($validator->errors()->get('value'));

                continue;
            }

            $clean[$definition->key] = $definition->type->cast($value);
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $actorId = $actor->getAuthIdentifier();
        $updatedBy = is_string($actorId) ? $actorId : null;

        $this->db->transaction(function () use ($clean, $updatedBy): void {
            foreach ($clean as $key => $value) {
                if ($value === null) {
                    Setting::query()->where('key', $key)->get()->each->delete();

                    continue;
                }

                $setting = Setting::query()->firstOrNew(['key' => $key]);
                $setting->value = $value;
                $setting->updated_by = $updatedBy;
                $setting->save();
            }
        });
    }

    public function can(Authenticatable $actor, string $permission): bool
    {
        return Gate::forUser($actor)->allows($permission);
    }

    /**
     * @return array<string, mixed>
     */
    private function stored(): array
    {
        /** @var array<string, mixed> */
        return Cache::remember(
            self::cacheKey($this->company->id()),
            self::TTL_SECONDS,
            fn (): array => Setting::query()->pluck('value', 'key')->all(),
        );
    }

    private static function cacheKey(string $companyId): string
    {
        return "settings:{$companyId}";
    }
}
