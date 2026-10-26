<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Support;

use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;

/**
 * Company settings of the stock ledger, with their registered defaults. Negative stock is a
 * property of each warehouse (Reference warehouses.negative_stock_policy).
 */
final class InventorySettings
{
    public const string VALUATION_METHOD = 'inventory.valuation_method';

    public const string COST_SCALE = 'inventory.cost_rounding_scale';

    public function __construct(private readonly SettingsReader $settings) {}

    public static function register(SettingsRegistrar $registrar): void
    {
        $registrar->register(new SettingDefinition(
            self::VALUATION_METHOD, SettingType::Enum, ValuationMethod::MovingAverage->value, 'inventory',
            rules: [new ValuationMethodRule],
            options: ValuationMethod::values(),
        ));
        $registrar->register(new SettingDefinition(self::COST_SCALE, SettingType::Int, 6, 'inventory', rules: ['min:2', 'max:6']));
    }

    public function valuationMethod(): ValuationMethod
    {
        $value = $this->settings->get(self::VALUATION_METHOD);

        return ValuationMethod::tryFrom(is_string($value) ? $value : '') ?? ValuationMethod::MovingAverage;
    }

    /**
     * Scale of unit costs and averages (2..6).
     *
     * @return int<2, 6>
     */
    public function costScale(): int
    {
        $value = $this->settings->get(self::COST_SCALE);

        return is_numeric($value) ? max(2, min(6, (int) $value)) : 6;
    }
}
