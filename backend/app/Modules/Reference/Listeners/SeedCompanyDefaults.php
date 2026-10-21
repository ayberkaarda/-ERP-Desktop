<?php

declare(strict_types=1);

namespace App\Modules\Reference\Listeners;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\CurrencyCatalog;
use App\Modules\Settings\Contracts\SettingsReader;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletingScope;

/**
 * Per-company Reference defaults for a new company, in one transaction:
 * - TRY, USD, EUR, GBP active in company_currencies (the global currency rows are created when
 *   missing, so this works without the ReferenceSeeder); the base currency setting
 *   company.base_currency defaults to TRY in the Settings registry,
 * - payment terms CASH (0 days) and NET15/30/45/60/90,
 * - the default warehouse MAIN with one location DEFAULT,
 * - the root cost center GENERAL.
 *
 * Codes are English and fixed; names are taken from lang files in the company's default language
 * (general.default_locale, tr unless configured). Idempotent: a record whose code already exists
 * (also soft deleted) is left untouched, so re-dispatching the event never duplicates or resets data.
 */
final class SeedCompanyDefaults
{
    /** @var list<string> */
    public const array CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'];

    /** @var list<int> */
    public const array NET_DAYS = [15, 30, 45, 60, 90];

    public const string WAREHOUSE = 'MAIN';

    public const string LOCATION = 'DEFAULT';

    public const string COST_CENTER = 'GENERAL';

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly CompanyContext $context,
        private readonly SettingsReader $settings,
    ) {}

    public function handle(CompanyCreated $event): void
    {
        if (! $event->seedDefaults) {
            return;
        }
        $this->context->runAs($event->companyId, fn () => $this->db->transaction(function (): void {
            $locale = $this->locale();
            CurrencyCatalog::ensure(self::CURRENCIES);
            foreach (self::CURRENCIES as $code) {
                if (! CompanyCurrency::query()->withTrashed()->where('currency_code', $code)->exists()) {
                    CompanyCurrency::query()->create(['currency_code' => $code, 'is_active' => true]);
                }
            }

            $this->ensure(PaymentTerm::class, 'CASH', [
                'name' => __('reference::defaults.payment_terms.cash', [], $locale), 'due_days' => 0,
            ]);
            foreach (self::NET_DAYS as $days) {
                $this->ensure(PaymentTerm::class, 'NET'.$days, [
                    'name' => __('reference::defaults.payment_terms.net', ['days' => $days], $locale), 'due_days' => $days,
                ]);
            }

            $hasDefault = Warehouse::query()->where('is_default', true)->exists();
            $warehouse = $this->ensure(Warehouse::class, self::WAREHOUSE, [
                'name' => __('reference::defaults.warehouse', [], $locale), 'is_default' => ! $hasDefault,
            ]);
            if ($warehouse !== null) {
                $location = new Location([
                    'warehouse_id' => $warehouse->getKey(), 'code' => self::LOCATION,
                    'name' => __('reference::defaults.location', [], $locale), 'type' => 'bin',
                ]);
                $location->save();
            }

            $this->ensure(CostCenter::class, self::COST_CENTER, [
                'name' => __('reference::defaults.cost_center', [], $locale),
            ]);
        }));
    }

    /**
     * Creates the record unless its code exists; returns the new record, or null when it existed.
     *
     * @template T of Model
     *
     * @param  class-string<T>  $model
     * @param  array<string, mixed>  $attributes
     * @return T|null
     */
    private function ensure(string $model, string $code, array $attributes): ?Model
    {
        // Soft deleted records count: a default the company deleted is not brought back.
        if ($model::query()->withoutGlobalScope(SoftDeletingScope::class)->where('code', $code)->exists()) {
            return null;
        }
        $record = new $model(['code' => $code, ...$attributes]);
        $record->save();

        return $record;
    }

    private function locale(): string
    {
        $locale = $this->settings->get('general.default_locale');

        return is_string($locale) && in_array($locale, ['tr', 'en', 'de', 'fr'], true) ? $locale : 'tr';
    }
}
