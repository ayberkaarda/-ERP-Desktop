<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;

/**
 * Company settings of the ledger, with their registered defaults.
 */
final class AccountingSettings
{
    public const string EXPENSE_SCHEME = 'accounting.expense_scheme';

    public const string CODE_PREFIX_RULE = 'accounting.account_code_prefix_rule';

    public const string CLOSING_MAPPING = 'accounting.closing_mapping';

    public const string BASE_CURRENCY = 'company.base_currency';

    /**
     * Default Turkish TDHP closing: income statement groups 6 and 7 close into 690; 690 and the tax
     * provision 691 close into 692; 692 closes into 590 (profit) or 591 (loss).
     */
    public const array DEFAULT_CLOSING = [
        'income_statement_groups' => [6, 7],
        'result_account' => '690',
        'tax_accounts' => ['691'],
        'net_result_account' => '692',
        'profit_account' => '590',
        'loss_account' => '591',
    ];

    public function __construct(private readonly SettingsReader $settings) {}

    public static function register(SettingsRegistrar $registrar): void
    {
        $registrar->register(new SettingDefinition(
            self::EXPENSE_SCHEME, SettingType::Enum, ExpenseScheme::A->value, 'accounting',
            options: array_map(static fn (ExpenseScheme $s): string => $s->value, ExpenseScheme::cases()),
        ));
        $registrar->register(new SettingDefinition(self::CODE_PREFIX_RULE, SettingType::Bool, true, 'accounting'));
        $registrar->register(new SettingDefinition(
            self::CLOSING_MAPPING, SettingType::Json, self::DEFAULT_CLOSING, 'accounting',
            rules: [new ClosingMappingRule],
        ));
    }

    public function expenseScheme(): ExpenseScheme
    {
        $value = $this->settings->get(self::EXPENSE_SCHEME);

        return ExpenseScheme::tryFrom(is_string($value) ? $value : '') ?? ExpenseScheme::A;
    }

    public function codePrefixRule(): bool
    {
        return $this->settings->get(self::CODE_PREFIX_RULE) !== false;
    }

    public function baseCurrency(): string
    {
        $value = $this->settings->get(self::BASE_CURRENCY);

        return is_string($value) && $value !== '' ? $value : 'TRY';
    }

    /**
     * @return array{income_statement_groups: list<int>, result_account: string, tax_accounts: list<string>, net_result_account: string, profit_account: string, loss_account: string}
     */
    public function closingMapping(): array
    {
        $value = $this->settings->get(self::CLOSING_MAPPING);
        $value = is_array($value) ? $value + self::DEFAULT_CLOSING : self::DEFAULT_CLOSING;
        $string = static fn (mixed $v, string $d): string => is_string($v) && $v !== '' ? $v : $d;

        return [
            'income_statement_groups' => array_values(array_map('intval', array_filter(
                is_array($value['income_statement_groups']) ? $value['income_statement_groups'] : [6, 7],
                'is_numeric',
            ))),
            'result_account' => $string($value['result_account'], '690'),
            'tax_accounts' => array_values(array_filter(is_array($value['tax_accounts']) ? $value['tax_accounts'] : [], 'is_string')),
            'net_result_account' => $string($value['net_result_account'], '692'),
            'profit_account' => $string($value['profit_account'], '590'),
            'loss_account' => $string($value['loss_account'], '591'),
        ];
    }
}
