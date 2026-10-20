<?php

declare(strict_types=1);

namespace App\Models;

use App\Core\Support\HasUuid7;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;
use Spatie\Permission\Traits\HasRoles;

/**
 * Application-wide user; owned by the identity module. Lives outside app/Modules so every
 * module may reference it without reaching into another module's models.
 *
 * @property string $id
 * @property string $name
 * @property string $email
 * @property string $password
 * @property string $locale
 * @property bool $is_super_admin
 * @property bool $is_active
 * @property bool $must_change_password
 * @property Carbon|null $deactivated_at
 * @property Carbon|null $password_changed_at
 * @property Carbon|null $last_login_at
 * @property string|null $two_factor_secret
 * @property list<string>|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property int|null $two_factor_last_timestep
 * @property int $auth_version
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
class User extends Authenticatable
{
    use HasApiTokens;

    /** @use HasFactory<UserFactory> */
    use HasFactory;

    use HasRoles;
    use HasUuid7;
    use LogsActivity;
    use Notifiable;
    use SoftDeletes;

    /** @var list<string> */
    protected $fillable = ['name', 'email', 'password', 'locale'];

    /** @var list<string> */
    protected $hidden = ['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'];

    /** @var array<string, mixed> */
    protected $attributes = [
        'locale' => 'tr',
        'is_super_admin' => false,
        'is_active' => true,
        'must_change_password' => false,
        'auth_version' => 0,
    ];

    protected string $guard_name = 'web';

    public function getMorphClass(): string
    {
        return 'user';
    }

    /**
     * Invalidates pending login challenges issued before a credential change.
     */
    public function bumpAuthVersion(): void
    {
        $this->forceFill(['auth_version' => $this->auth_version + 1])->save();
    }

    public function hasTwoFactorEnabled(): bool
    {
        return $this->two_factor_secret !== null && $this->two_factor_confirmed_at !== null;
    }

    public function setEmailAttribute(string $value): void
    {
        $this->attributes['email'] = mb_strtolower(trim($value));
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['name', 'email', 'locale', 'is_super_admin', 'is_active', 'must_change_password', 'deactivated_at', 'deleted_at'])
            ->logOnlyDirty()
            ->dontLogEmptyChanges();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_super_admin' => 'boolean',
            'is_active' => 'boolean',
            'must_change_password' => 'boolean',
            'deactivated_at' => 'datetime',
            'password_changed_at' => 'datetime',
            'last_login_at' => 'datetime',
            'two_factor_secret' => 'encrypted',
            'two_factor_recovery_codes' => 'encrypted:array',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_last_timestep' => 'integer',
            'auth_version' => 'integer',
        ];
    }
}
