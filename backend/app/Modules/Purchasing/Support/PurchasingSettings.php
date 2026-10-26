<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Support;

use App\Modules\Purchasing\Enums\MatchMode;
use App\Modules\Purchasing\Enums\RoundingScope;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;
use Brick\Math\BigDecimal;
use Illuminate\Support\Str;

/**
 * Company settings of the purchasing module with their registered defaults. Amount and id settings
 * are strings where an empty value means "not set"; tolerances are percentages (decimal strings).
 */
final class PurchasingSettings
{
    public const string ALLOW_DIRECT_RECEIPT = 'purchasing.allow_direct_receipt';

    public const string MATCH_MODE = 'purchasing.match_mode';

    public const string MATCH_QTY_TOLERANCE = 'purchasing.match_qty_tolerance_percent';

    public const string MATCH_PRICE_TOLERANCE = 'purchasing.match_price_tolerance_percent';

    public const string OVER_RECEIPT_PERCENT = 'purchasing.allow_over_receipt_percent';

    public const string REQUIRE_APPROVAL_OVER = 'purchasing.require_approval_over';

    public const string REQUEST_APPROVAL_OVER = 'purchasing.request_approval_over';

    public const string INVOICE_APPROVAL_OVER = 'purchasing.invoice_approval_over';

    public const string DEFAULT_WAREHOUSE = 'purchasing.default_warehouse_id';

    public const string ROUNDING = 'purchasing.rounding';

    public const array KEYS = [
        self::ALLOW_DIRECT_RECEIPT, self::MATCH_MODE, self::MATCH_QTY_TOLERANCE, self::MATCH_PRICE_TOLERANCE, self::OVER_RECEIPT_PERCENT,
        self::REQUIRE_APPROVAL_OVER, self::REQUEST_APPROVAL_OVER, self::INVOICE_APPROVAL_OVER, self::DEFAULT_WAREHOUSE, self::ROUNDING,
    ];

    private const string AMOUNT = '/^(\d{1,16}(\.\d{1,4})?)?$/';

    private const string PERCENT = '/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/';

    public function __construct(private readonly SettingsReader $settings) {}

    public static function register(SettingsRegistrar $registrar): void
    {
        $registrar->register(new SettingDefinition(self::ALLOW_DIRECT_RECEIPT, SettingType::Bool, false, 'purchasing'));
        $registrar->register(new SettingDefinition(self::MATCH_MODE, SettingType::Enum, MatchMode::Warn->value, 'purchasing', options: MatchMode::values()));
        $registrar->register(new SettingDefinition(self::MATCH_QTY_TOLERANCE, SettingType::String, '0', 'purchasing', rules: ['regex:'.self::PERCENT]));
        $registrar->register(new SettingDefinition(self::MATCH_PRICE_TOLERANCE, SettingType::String, '0', 'purchasing', rules: ['regex:'.self::PERCENT]));
        $registrar->register(new SettingDefinition(self::OVER_RECEIPT_PERCENT, SettingType::Int, 0, 'purchasing', rules: ['min:0', 'max:100']));
        $registrar->register(new SettingDefinition(self::REQUIRE_APPROVAL_OVER, SettingType::String, '', 'purchasing', rules: ['nullable', 'regex:'.self::AMOUNT]));
        $registrar->register(new SettingDefinition(self::REQUEST_APPROVAL_OVER, SettingType::String, '', 'purchasing', rules: ['nullable', 'regex:'.self::AMOUNT]));
        $registrar->register(new SettingDefinition(self::INVOICE_APPROVAL_OVER, SettingType::String, '', 'purchasing', rules: ['nullable', 'regex:'.self::AMOUNT]));
        $registrar->register(new SettingDefinition(self::DEFAULT_WAREHOUSE, SettingType::String, '', 'purchasing', rules: ['nullable', 'regex:/^([0-9a-fA-F-]{36})?$/']));
        $registrar->register(new SettingDefinition(self::ROUNDING, SettingType::Enum, RoundingScope::PerLine->value, 'purchasing', options: RoundingScope::values()));
    }

    public function allowDirectReceipt(): bool
    {
        return $this->settings->get(self::ALLOW_DIRECT_RECEIPT) === true;
    }

    public function matchMode(): MatchMode
    {
        $value = $this->settings->get(self::MATCH_MODE);

        return MatchMode::tryFrom(is_string($value) ? $value : '') ?? MatchMode::Warn;
    }

    public function qtyTolerance(): BigDecimal
    {
        return $this->percent(self::MATCH_QTY_TOLERANCE);
    }

    public function priceTolerance(): BigDecimal
    {
        return $this->percent(self::MATCH_PRICE_TOLERANCE);
    }

    public function overReceiptPercent(): int
    {
        $value = $this->settings->get(self::OVER_RECEIPT_PERCENT);

        return is_numeric($value) ? max(0, min(100, (int) $value)) : 0;
    }

    /** Local total from which an order needs approval; null = never. */
    public function orderApprovalThreshold(): ?string
    {
        return $this->amount(self::REQUIRE_APPROVAL_OVER);
    }

    public function requestApprovalThreshold(): ?string
    {
        return $this->amount(self::REQUEST_APPROVAL_OVER);
    }

    public function invoiceApprovalThreshold(): ?string
    {
        return $this->amount(self::INVOICE_APPROVAL_OVER);
    }

    public function defaultWarehouseId(): ?string
    {
        $value = $this->settings->get(self::DEFAULT_WAREHOUSE);

        return is_string($value) && Str::isUuid($value) ? $value : null;
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

    private function amount(string $key): ?string
    {
        $value = $this->settings->get($key);

        return is_string($value) && preg_match('/^\d{1,16}(\.\d{1,4})?$/', $value) === 1 ? $value : null;
    }

    private function percent(string $key): BigDecimal
    {
        $value = $this->settings->get($key);

        return is_string($value) && preg_match(self::PERCENT, $value) === 1 ? BigDecimal::of($value)
            : (is_int($value) && $value >= 0 && $value <= 100 ? BigDecimal::of($value) : BigDecimal::zero());
    }
}
