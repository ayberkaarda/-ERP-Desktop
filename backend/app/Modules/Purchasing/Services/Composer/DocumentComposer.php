<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Composer;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Data\ItemData;
use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Parties\Contracts\PartyAddressLookup;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Services\Totals\LineInput;
use App\Modules\Purchasing\Services\Totals\TotalsEngine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\DimensionLookup;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Reference\Enums\TaxType;
use App\Modules\Reference\Exceptions\RateNotFound;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Str;

/**
 * Turns client (or converted) header and line data into validated document columns: supplier
 * snapshot, currency and rate, payment term and due date, dimensions, items and units, prices,
 * VAT and withholding snapshots through TaxCodeLookup at the document date, and totals through
 * TotalsEngine. Nothing is persisted here.
 *
 * There is no purchase price list: a line without a source needs an explicit unit_price. Internal
 * line keys set by conversions: `_fixed` (price, discount and tax inclusion come from the source;
 * a different unit_price given by the client is a price override), `_source_price` (the source's
 * price, compared with unit_price), `_price_source`, `_tax_rate` / `_withholding_rate` (keep these
 * rates instead of looking the codes up again), `_base_quantity` (keep the source's base quantity).
 */
final class DocumentComposer
{
    public function __construct(
        private readonly PartyLookup $parties,
        private readonly PartyAddressLookup $addresses,
        private readonly ItemLookup $items,
        private readonly UnitLookup $units,
        private readonly TaxCodeLookup $taxCodes,
        private readonly CurrencyLookup $currencies,
        private readonly PaymentTermLookup $paymentTerms,
        private readonly ExchangeRateProvider $rates,
        private readonly WarehouseLookup $warehouses,
        private readonly DimensionLookup $dimensions,
        private readonly PurchasingSettings $settings,
        private readonly TotalsEngine $engine,
    ) {}

    /**
     * @param  array<string, mixed>  $header  validated header input (complete: merge with stored values before calling)
     * @param  list<array<string, mixed>>  $lines
     */
    public function compose(array $header, array $lines, ComposeOptions $options = new ComposeOptions): Composed
    {
        if (count($lines) > PurchaseDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => PurchaseDocument::MAX_LINES]);
        }

        $date = self::str($header['document_date'] ?? null) ?? now()->toDateString();
        $day = new DateTimeImmutable($date);
        $party = $this->supplier(self::str($header['party_id'] ?? null));
        $base = $this->settings->baseCurrency();
        $currency = self::str($header['currency_code'] ?? null) ?? $party->defaultCurrencyCode ?? $base;

        if (! $this->currencies->exists($currency)) {
            Messages::fail('currency_code', 'currency_unknown', ['currency' => $currency]);
        }

        $fxRate = $this->fxRate($currency, $base, $day, self::str($header['fx_rate'] ?? null));
        $paymentTerm = array_key_exists('payment_term_id', $header) ? self::str($header['payment_term_id']) : $party->paymentTermId;

        if ($paymentTerm !== null && ! $this->paymentTerms->exists($paymentTerm)) {
            Messages::fail('payment_term_id', 'payment_term_unknown');
        }

        $warehouse = array_key_exists('warehouse_id', $header) ? self::str($header['warehouse_id']) : null;
        $warehouse ??= $this->defaultWarehouse();
        $this->assertWarehouse($warehouse, 'warehouse_id');
        $this->assertDimensions($header);
        $dueDate = self::str($header['due_date'] ?? null) ?? $this->dueDate($paymentTerm, $date);

        $built = [];
        $inputs = [];
        $warnings = [];
        $overrides = [];

        foreach ($lines as $i => $line) {
            [$row, $input, $override] = $this->line($i, $line, $day, $warehouse, $options);
            $built[] = $row;
            $inputs[] = $input;

            if ($override !== null) {
                $overrides[] = $override;

                if (! $options->canOverridePrice) {
                    $warnings[] = ['code' => 'purchasing.price_override_forbidden', 'line' => $i, 'message' => Messages::get('price_override_forbidden')];
                }
            }
        }

        $totals = $this->engine->compute($inputs, $this->settings->rounding(), $fxRate);

        foreach ($built as $i => $row) {
            $result = $totals->lines[$i];
            $built[$i] = [
                ...$row,
                'gross_amount' => $result->gross,
                'line_discount' => $result->lineDiscount,
                'net_amount' => $result->net,
                'tax_amount' => $result->tax,
                'withholding_amount' => $result->withholding,
                'line_total' => $result->lineTotal,
            ];
        }

        $headerColumns = [
            'document_date' => $date,
            'party_id' => $party->id,
            'party_name' => $party->legalName ?? $party->name,
            'party_tax_office' => $party->taxOffice,
            'party_tax_number' => $party->taxNumber,
            'billing_address' => array_key_exists('billing_address', $header) && is_array($header['billing_address'])
                ? $header['billing_address'] : $this->addresses->billingAddress($party->id),
            'currency_code' => $currency,
            'fx_rate' => $fxRate,
            'payment_term_id' => $paymentTerm,
            'due_date' => $dueDate,
            'warehouse_id' => $warehouse,
            'cost_center_id' => self::str($header['cost_center_id'] ?? null),
            'project_id' => self::str($header['project_id'] ?? null),
            'notes' => self::str($header['notes'] ?? null),
            'internal_notes' => self::str($header['internal_notes'] ?? null),
            ...$totals->headerAttributes(),
        ];

        return new Composed($headerColumns, $built, $totals, $warnings, $overrides);
    }

    /** An active supplier of the active company. */
    public function supplier(?string $partyId, string $field = 'party_id'): PartyData
    {
        $party = $partyId === null || ! Str::isUuid($partyId) ? null : $this->parties->find($partyId);

        if ($party === null) {
            Messages::fail($field, 'party_unknown');
        }

        if (! $party->isActive) {
            Messages::fail($field, 'party_inactive');
        }

        if (! $party->isSupplier()) {
            Messages::fail($field, 'party_not_supplier');
        }

        return $party;
    }

    public function item(?string $itemId, string $field): ItemData
    {
        $item = $itemId === null || ! Str::isUuid($itemId) ? null : $this->items->find($itemId);

        if ($item === null) {
            Messages::fail("{$field}.item_id", 'item_unknown');
        }

        if (! $item->isActive) {
            Messages::fail("{$field}.item_id", 'item_inactive', ['item' => $item->code]);
        }

        return $item;
    }

    /**
     * Item, variant, unit and quantities of a line (requests and RFQs use this part only).
     *
     * @param  array<string, mixed>  $line
     * @return array{item: ItemData, variant: string|null, unit: string, quantity: string, base: string}
     */
    public function quantities(array $line, string $field): array
    {
        $item = $this->item(self::str($line['item_id'] ?? null), $field);
        $variant = self::str($line['variant_id'] ?? null);

        if ($variant !== null && ! $this->items->variantBelongsTo($variant, $item->id)) {
            Messages::fail("{$field}.variant_id", 'variant_unknown');
        }

        $unit = self::str($line['unit_id'] ?? null) ?? $item->baseUnitId;

        if (! $this->units->exists($unit)) {
            Messages::fail("{$field}.unit_id", 'unit_unknown');
        }

        $qty = Purchasing::qty(self::str($line['quantity'] ?? null) ?? '0');

        if (! BigDecimal::of($qty)->isPositive()) {
            Messages::fail("{$field}.quantity", 'quantity_positive');
        }

        if (! $this->units->canConvert($unit, $item->baseUnitId, $item->id)) {
            Messages::fail("{$field}.unit_id", 'unit_not_convertible');
        }

        // A line copied from a source document keeps the source's stored base quantity (prorated).
        $fixedBase = self::str($line['_base_quantity'] ?? null);
        $base = $fixedBase ?? ($unit === $item->baseUnitId ? $qty : $this->units->convert($qty, $unit, $item->baseUnitId, $item->id, 6));

        return ['item' => $item, 'variant' => $variant, 'unit' => $unit, 'quantity' => $qty, 'base' => Purchasing::qty($base)];
    }

    public function assertWarehouse(?string $warehouseId, string $field): void
    {
        if ($warehouseId === null) {
            return;
        }

        $warehouse = Str::isUuid($warehouseId) ? $this->warehouses->find($warehouseId) : null;

        if ($warehouse === null || ! $warehouse->isActive) {
            Messages::fail($field, 'warehouse_unavailable');
        }
    }

    public function defaultWarehouse(): ?string
    {
        return $this->settings->defaultWarehouseId() ?? $this->warehouses->default()?->id;
    }

    /**
     * @param  array<string, mixed>  $header
     */
    public function assertDimensions(array $header): void
    {
        foreach (['cost_center_id' => 'costCenterExists', 'project_id' => 'projectExists'] as $field => $method) {
            $id = self::str($header[$field] ?? null);

            if ($id !== null && ! $this->dimensions->{$method}($id)) {
                Messages::fail($field, 'dimension_unknown');
            }
        }
    }

    public function assertCurrency(string $currency, string $field = 'currency_code'): void
    {
        if (! $this->currencies->exists($currency)) {
            Messages::fail($field, 'currency_unknown', ['currency' => $currency]);
        }
    }

    /**
     * @param  array<string, mixed>  $line
     * @return array{0: array<string, mixed>, 1: LineInput, 2: array{line: int, source: string, given: string}|null}
     */
    private function line(int $i, array $line, DateTimeImmutable $day, ?string $warehouse, ComposeOptions $options): array
    {
        $field = "lines.{$i}";
        ['item' => $item, 'variant' => $variant, 'unit' => $unit, 'quantity' => $qty, 'base' => $baseQty] = $this->quantities($line, $field);
        $lineWarehouse = self::str($line['warehouse_id'] ?? null);
        $this->assertWarehouse($lineWarehouse, "{$field}.warehouse_id");

        if ($options->requireWarehouse && $item->type === 'stock' && ($lineWarehouse ?? $warehouse) === null) {
            Messages::fail('warehouse_id', 'warehouse_required');
        }

        $override = null;
        $given = self::str($line['unit_price'] ?? null);
        $sourcePrice = self::str($line['_source_price'] ?? null);

        if (($line['_fixed'] ?? false) === true) {
            $price = $given ?? $sourcePrice ?? '0';
            $source = self::str($line['_price_source'] ?? null) ?? 'source';

            if ($sourcePrice !== null && $given !== null && ! BigDecimal::of($given)->isEqualTo($sourcePrice)) {
                $override = ['line' => $i, 'source' => Purchasing::qty($sourcePrice), 'given' => Purchasing::qty($given)];
                $source = 'manual';

                if (! $options->canOverridePrice && $options->strict) {
                    Messages::fail("{$field}.unit_price", 'price_override_forbidden');
                }
            }
        } else {
            if ($given === null) {
                Messages::fail("{$field}.unit_price", 'price_missing', ['item' => $item->code]);
            }

            $price = $given;
            $source = self::str($line['_price_source'] ?? null) ?? 'manual';
        }

        [$taxCodeId, $rate] = $this->tax($line, $item, $day, $field);
        [$withholdingId, $withholdingRate] = $this->withholding($line, $taxCodeId, $day, $field);
        $discountAmount = Purchasing::money(self::str($line['discount_amount'] ?? null) ?? '0');
        $discountPercent = (string) BigDecimal::of(self::str($line['discount_percent'] ?? null) ?? '0')->toScale(4, RoundingMode::HalfUp);
        $taxInclusive = isset($line['tax_inclusive']) && (bool) $line['tax_inclusive'];

        $row = [
            'line_no' => $i + 1,
            'item_id' => $item->id,
            'variant_id' => $variant,
            'item_type' => $item->type,
            'description' => self::str($line['description'] ?? null) ?? mb_substr($item->name, 0, 500),
            'quantity' => $qty,
            'unit_id' => $unit,
            'base_quantity' => $baseQty,
            'unit_price' => Purchasing::qty($price),
            'tax_inclusive' => $taxInclusive,
            'discount_percent' => $discountPercent,
            'discount_amount' => $discountAmount,
            'tax_code_id' => $taxCodeId,
            'tax_rate' => $rate,
            'withholding_code_id' => $withholdingId,
            'withholding_rate' => $withholdingRate,
            'warehouse_id' => $lineWarehouse,
            'source_line_id' => self::str($line['source_line_id'] ?? null),
            'price_source' => $source,
        ];

        $input = new LineInput($qty, Purchasing::qty($price), $discountPercent, $discountAmount, $rate, $taxInclusive, $taxCodeId, $withholdingRate);

        return [$row, $input, $override];
    }

    /**
     * The line's VAT code (explicit, explicit null = untaxed, else the item's purchase or default
     * code) and its rate at the date.
     *
     * @param  array<string, mixed>  $line
     * @return array{0: string|null, 1: string}
     */
    private function tax(array $line, ItemData $item, DateTimeImmutable $day, string $field): array
    {
        $code = array_key_exists('tax_code_id', $line) ? self::str($line['tax_code_id']) : ($item->purchaseTaxCodeId ?? $item->defaultTaxCodeId);

        if ($code === null) {
            return [null, '0.0000'];
        }

        $fixed = self::str($line['_tax_rate'] ?? null);

        if ($fixed !== null) {
            return [$code, (string) BigDecimal::of($fixed)->toScale(4, RoundingMode::HalfUp)];
        }

        $tax = Str::isUuid($code) ? $this->taxCodes->find($code, $day) : null;

        if ($tax === null) {
            Messages::fail("{$field}.tax_code_id", 'tax_code_unavailable');
        }

        if (! in_array($tax->type, [TaxType::Vat, TaxType::Exemption], true)) {
            Messages::fail("{$field}.tax_code_id", 'tax_type_unsupported');
        }

        return [$tax->id, (string) BigDecimal::of($tax->rate ?? '0')->toScale(4, RoundingMode::HalfUp)];
    }

    /**
     * The withholding (tevkifat) code of a line and the withheld share of its VAT in percent.
     *
     * @param  array<string, mixed>  $line
     * @return array{0: string|null, 1: string}
     */
    private function withholding(array $line, ?string $taxCodeId, DateTimeImmutable $day, string $field): array
    {
        $code = self::str($line['withholding_code_id'] ?? null);

        if ($code === null) {
            return [null, '0.0000'];
        }

        if ($taxCodeId === null) {
            Messages::fail("{$field}.withholding_code_id", 'withholding_without_vat');
        }

        $fixed = self::str($line['_withholding_rate'] ?? null);

        if ($fixed !== null) {
            return [$code, (string) BigDecimal::of($fixed)->toScale(4, RoundingMode::HalfUp)];
        }

        $tax = Str::isUuid($code) ? $this->taxCodes->find($code, $day) : null;

        if ($tax === null || $tax->type !== TaxType::Withholding || $tax->numerator === null || $tax->denominator === null || $tax->denominator === 0) {
            Messages::fail("{$field}.withholding_code_id", 'withholding_code_unavailable');
        }

        return [$tax->id, (string) BigDecimal::of($tax->numerator)->multipliedBy(100)->dividedBy($tax->denominator, 4, RoundingMode::HalfUp)];
    }

    private function fxRate(string $currency, string $base, DateTimeImmutable $day, ?string $given): string
    {
        if ($currency === $base) {
            return '1.000000';
        }

        if ($given !== null) {
            if (! BigDecimal::of($given)->isPositive()) {
                Messages::fail('fx_rate', 'fx_rate_invalid');
            }

            return Purchasing::qty($given);
        }

        try {
            return Purchasing::qty($this->rates->rate($currency, $base, $day));
        } catch (RateNotFound) {
            Messages::fail('fx_rate', 'fx_rate_missing', ['currency' => $currency]);
        }
    }

    /** Document date plus the payment term's days. */
    private function dueDate(?string $paymentTermId, string $date): string
    {
        $days = $paymentTermId === null ? null : $this->paymentTerms->dueDays($paymentTermId);

        return (new DateTimeImmutable($date))->modify('+'.($days ?? 0).' days')->format('Y-m-d');
    }

    public static function str(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string) $value;
        }

        return is_string($value) && $value !== '' ? $value : null;
    }
}
