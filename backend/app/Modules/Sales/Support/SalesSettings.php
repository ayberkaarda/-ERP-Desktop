<?php

declare(strict_types=1);

namespace App\Modules\Sales\Support;

use App\Modules\Sales\Enums\CreditCheckMode;
use App\Modules\Sales\Enums\RoundingScope;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;
use Illuminate\Support\Str;

/**
 * Company settings of the sales module with their registered defaults. Amount and id settings are
 * strings where an empty value means "not set".
 */
final class SalesSettings
{
    public const string ALLOW_DIRECT_DELIVERY = 'sales.allow_direct_delivery';

    public const string CREDIT_CHECK_MODE = 'sales.credit_check_mode';

    public const string RESERVE_ON_CONFIRM = 'sales.reserve_on_confirm';

    public const string REQUIRE_APPROVAL_OVER = 'sales.require_approval_over';

    public const string DEFAULT_WAREHOUSE = 'sales.default_warehouse_id';

    public const string QUOTE_VALIDITY_DAYS = 'sales.quote_validity_days';

    public const string OVER_DELIVERY_PERCENT = 'sales.allow_over_delivery_percent';

    public const string ROUNDING = 'sales.rounding';

    public const array KEYS = [
        self::ALLOW_DIRECT_DELIVERY, self::CREDIT_CHECK_MODE, self::RESERVE_ON_CONFIRM, self::REQUIRE_APPROVAL_OVER,
        self::DEFAULT_WAREHOUSE, self::QUOTE_VALIDITY_DAYS, self::OVER_DELIVERY_PERCENT, self::ROUNDING,
    ];

    public function __construct(private readonly SettingsReader $settings) {}

    public static function register(SettingsRegistrar $registrar): void
    {
        $registrar->register(new SettingDefinition(self::ALLOW_DIRECT_DELIVERY, SettingType::Bool, false, 'sales'));
        $registrar->register(new SettingDefinition(self::CREDIT_CHECK_MODE, SettingType::Enum, CreditCheckMode::Warn->value, 'sales', options: CreditCheckMode::values()));
        $registrar->register(new SettingDefinition(self::RESERVE_ON_CONFIRM, SettingType::Bool, true, 'sales'));
        $registrar->register(new SettingDefinition(self::REQUIRE_APPROVAL_OVER, SettingType::String, '', 'sales', rules: ['nullable', 'regex:/^(\d{1,16}(\.\d{1,4})?)?$/']));
        $registrar->register(new SettingDefinition(self::DEFAULT_WAREHOUSE, SettingType::String, '', 'sales', rules: ['nullable', 'regex:/^([0-9a-fA-F-]{36})?$/']));
        $registrar->register(new SettingDefinition(self::QUOTE_VALIDITY_DAYS, SettingType::Int, 30, 'sales', rules: ['min:0', 'max:3650']));
        $registrar->register(new SettingDefinition(self::OVER_DELIVERY_PERCENT, SettingType::Int, 0, 'sales', rules: ['min:0', 'max:100']));
        $registrar->register(new SettingDefinition(self::ROUNDING, SettingType::Enum, RoundingScope::PerLine->value, 'sales', options: RoundingScope::values()));
    }

    public function allowDirectDelivery(): bool
    {
        return $this->settings->get(self::ALLOW_DIRECT_DELIVERY) === true;
    }

    public function creditCheckMode(): CreditCheckMode
    {
        $value = $this->settings->get(self::CREDIT_CHECK_MODE);

        return CreditCheckMode::tryFrom(is_string($value) ? $value : '') ?? CreditCheckMode::Warn;
    }

    public function reserveOnConfirm(): bool
    {
        return $this->settings->get(self::RESERVE_ON_CONFIRM) !== false;
    }

    /** Local total from which an order needs approval; null = never. */
    public function approvalThreshold(): ?string
    {
        $value = $this->settings->get(self::REQUIRE_APPROVAL_OVER);

        return is_string($value) && preg_match('/^\d{1,16}(\.\d{1,4})?$/', $value) === 1 ? $value : null;
    }

    public function defaultWarehouseId(): ?string
    {
        $value = $this->settings->get(self::DEFAULT_WAREHOUSE);

        return is_string($value) && Str::isUuid($value) ? $value : null;
    }

    public function quoteValidityDays(): int
    {
        $value = $this->settings->get(self::QUOTE_VALIDITY_DAYS);

        return is_numeric($value) ? max(0, (int) $value) : 30;
    }

    public function overDeliveryPercent(): int
    {
        $value = $this->settings->get(self::OVER_DELIVERY_PERCENT);

        return is_numeric($value) ? max(0, min(100, (int) $value)) : 0;
    }

    public function rounding(): RoundingScope
    {
        $value = $this->settings->get(self::ROUNDING);

        return RoundingScope::tryFrom(is_string($value) ? $value : '') ?? RoundingScope::PerLine;
    }

    public function baseCurrency(): string
    {
        $value = $this->settings->get('company.base_currency');

        return is_string($value) && preg_match('/^[A-Z]{3}$/', $value) === 1 ? $value : 'TRY';
    }
}
