<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Listeners;

use App\Core\Company\CompanyContext;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Settings\Contracts\SettingsReader;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\SoftDeletingScope;

/**
 * Default units of measure for a new company, in one transaction, plus the conversions that hold
 * for every item (KG/G, M/CM, DAY/HOUR; packaging units such as BOX/PCS depend on the item and are
 * left to item units). Codes are English and fixed; names and symbols come from lang files in the
 * company's default language (general.default_locale, tr unless configured).
 *
 * Idempotent: an existing code (also soft deleted) is left untouched and a conversion is only
 * added when both units are live and neither has a conversion yet.
 */
final class SeedDefaultUnits
{
    /** @var list<string> */
    public const array UNITS = ['PCS', 'KG', 'G', 'LT', 'M', 'CM', 'M2', 'M3', 'BOX', 'PACK', 'HOUR', 'DAY'];

    /** @var list<array{0: string, 1: string, 2: string}> 1 from = factor to */
    public const array CONVERSIONS = [['KG', 'G', '1000'], ['M', 'CM', '100'], ['DAY', 'HOUR', '24']];

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
            $existing = Unit::query()->withoutGlobalScope(SoftDeletingScope::class)->whereIn('code', self::UNITS)->pluck('code')->all();
            foreach (self::UNITS as $code) {
                if (! in_array($code, $existing, true)) {
                    Unit::query()->create([
                        'code' => $code,
                        'name' => __('catalog::defaults.units.'.$code.'.name', [], $locale),
                        'symbol' => __('catalog::defaults.units.'.$code.'.symbol', [], $locale),
                        'is_active' => true,
                    ]);
                }
            }

            /** @var array<string, string> $ids live units only */
            $ids = Unit::query()->whereIn('code', self::UNITS)->pluck('id', 'code')->all();
            foreach (self::CONVERSIONS as [$from, $to, $factor]) {
                if (! isset($ids[$from], $ids[$to]) || $this->converted($ids[$from], $ids[$to])) {
                    continue;
                }
                UnitConversion::query()->create(['from_unit_id' => $ids[$from], 'to_unit_id' => $ids[$to], 'factor' => $factor]);
            }
        }));
    }

    /**
     * Either unit already has a conversion: adding another edge could close a cycle in the unit
     * graph (which must stay a forest), so the existing setup is respected.
     */
    private function converted(string $a, string $b): bool
    {
        return UnitConversion::query()->where(fn ($q) => $q->whereIn('from_unit_id', [$a, $b])->orWhereIn('to_unit_id', [$a, $b]))->exists();
    }

    private function locale(): string
    {
        $locale = $this->settings->get('general.default_locale');

        return is_string($locale) && in_array($locale, ['tr', 'en', 'de', 'fr'], true) ? $locale : 'tr';
    }
}
