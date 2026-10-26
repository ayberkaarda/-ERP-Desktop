<?php

declare(strict_types=1);

namespace App\Modules\Settings\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use App\Modules\Settings\Services\SettingsService;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $company_id
 * @property string $key
 * @property mixed $value
 * @property string|null $updated_by
 */
class Setting extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    protected $table = 'settings';

    protected $guarded = [];

    protected static function booted(): void
    {
        // Any write path (not only the service) must drop the company cache.
        $forget = static fn (self $setting) => SettingsService::forget($setting->company_id);
        static::saved($forget);
        static::deleted($forget);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['value' => 'json'];
    }
}
