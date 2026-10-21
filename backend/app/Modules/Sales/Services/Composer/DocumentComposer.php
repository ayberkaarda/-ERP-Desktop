<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Composer;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\PriceListLookup;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Data\ItemData;
use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Parties\Contracts\PartyAddressLookup;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\DimensionLookup;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Reference\Enums\TaxType;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Services\Totals\LineInput;
use App\Modules\Sales\Services\Totals\TotalsEngine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Str;

/**
 * Turns client (or converted) header and line data into validated document columns: party
 * snapshot, currency and rate, payment term and due date, dimensions, items and units, prices
 * through PriceResolver (with the override rule), tax snapshots through TaxCodeLookup at the
 * document date, and totals through TotalsEngine. Nothing is persisted here.
 *
 * Internal line keys set by conversions: `_fixed` (keep unit_price/discount/tax_inclusive as given,
 * price_source "source"), `_tax_rate` (keep this rate instead of looking the code up again).
 */
final class DocumentComposer
{
    public function __construct(
        private readonly PartyLookup $parties,
        private readonly PartyAddressLookup $addresses,
        private readonly ItemLookup $items,
        private readonly UnitLookup $units,
        private readonly PriceResolver $prices,
        private readonly PriceListLookup $priceLists,
        private readonly TaxCodeLookup $taxCodes,
        private readonly CurrencyLookup $currencies,
        private readonly PaymentTermLookup $paymentTerms,
        private readonly ExchangeRateProvider $rates,
        private readonly WarehouseLookup $warehouses,
        private readonly DimensionLookup $dimensions,
        private readonly SalesSettings $settings,
        private readonly TotalsEngine $engine,
    ) {}

    /**
     * @param  array<string, mixed>  $header  validated header input (complete: merge with stored values before calling)
     * @param  list<array<string, mixed>>  $lines
     */
    public function compose(array $header, array $lines, ComposeOptions $options = new ComposeOptions): Composed
    {
        if (count($lines) > SalesDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => SalesDocument::MAX_LINES]);
        }

        $date = self::str($header['document_date'] ?? null) ?? now()->toDateString();
        $day = new DateTimeImmutable($date);
        $party = $this->party(self::str($header['party_id'] ?? null));
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

        $priceList = array_key_exists('price_list_id', $header) ? self::str($header['price_list_id']) : $party->priceListId;

        if ($priceList !== null && ! $this->priceLists->exists($priceList)) {
            Messages::fail('price_list_id', 'price_list_unknown');
        }

        $warehouse = array_key_exists('warehouse_id', $header) ? self::str($header['warehouse_id']) : null;
        $warehouse ??= $this->settings->defaultWarehouseId() ?? $this->warehouses->default()?->id;
        $this->assertWarehouse($warehouse, 'warehouse_id');

        foreach (['cost_center_id' => 'costCenterExists', 'project_id' => 'projectExists'] as $field => $method) {
            $id = self::str($header[$field] ?? null);

            if ($id !== null && ! $this->dimensions->{$method}($id)) {
                Messages::fail($field, 'dimension_unknown');
            }
        }

        $dueDate = self::str($header['due_date'] ?? null) ?? $this->dueDate($paymentTerm, $date);

        $built = [];
        $inputs = [];
        $warnings = [];
        $overrides = [];
        $pricing = [];

        foreach ($lines as $i => $line) {
            [$row, $input, $resolved, $override] = $this->line($i, $line, $party, $currency, $day, $warehouse, $options);
            $built[] = $row;
            $inputs[] = $input;
            $pricing[] = $resolved;

            if ($override !== null) {
                $overrides[] = $override;

                if (! $options->canOverridePrice) {
                    $warnings[] = ['code' => 'sales.price_override_forbidden', 'line' => $i, 'message' => Messages::get('price_override_forbidden')];
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
                ? $header['billing_address'] : $this->billingAddress($party->id),
            'currency_code' => $currency,
            'fx_rate' => $fxRate,
            'payment_term_id' => $paymentTerm,
            'due_date' => $dueDate,
            'price_list_id' => $priceList,
            'warehouse_id' => $warehouse,
            'cost_center_id' => self::str($header['cost_center_id'] ?? null),
            'project_id' => self::str($header['project_id'] ?? null),
            'notes' => self::str($header['notes'] ?? null),
            'internal_notes' => self::str($header['internal_notes'] ?? null),
            ...$totals->headerAttributes(),
        ];

        return new Composed($headerColumns, $built, $totals, $warnings, $overrides, $pricing);
    }

    public function party(?string $partyId): PartyData
    {
        $party = $partyId === null || ! Str::isUuid($partyId) ? null : $this->parties->find($partyId);

        if ($party === null) {
            Messages::fail('party_id', 'party_unknown');
        }

        if (! $party->isActive) {
            Messages::fail('party_id', 'party_inactive');
        }

        if (! $party->isCustomer()) {
            Messages::fail('party_id', 'party_not_customer');
        }

        return $party;
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

    /**
     * @param  array<string, mixed>  $line
     * @return array{0: array<string, mixed>, 1: LineInput, 2: array<string, mixed>|null, 3: array{line: int, resolved: string|null, given: string}|null}
     */
    private function line(int $i, array $line, PartyData $party, string $currency, DateTimeImmutable $day, ?string $warehouse, ComposeOptions $options): array
    {
        $field = "lines.{$i}";
        $item = $this->item(self::str($line['item_id'] ?? null), $field);
        $variant = self::str($line['variant_id'] ?? null);

        if ($variant !== null && ! $this->items->variantBelongsTo($variant, $item->id)) {
            Messages::fail("{$field}.variant_id", 'variant_unknown');
        }

        $unit = self::str($line['unit_id'] ?? null) ?? $item->baseUnitId;

        if (! $this->units->exists($unit)) {
            Messages::fail("{$field}.unit_id", 'unit_unknown');
        }

        $qty = Sales::qty(self::str($line['quantity'] ?? null) ?? '0');

        if (! BigDecimal::of($qty)->isPositive()) {
            Messages::fail("{$field}.quantity", 'quantity_positive');
        }

        // A line copied from a source document keeps the source's stored base quantity (prorated):
        // a later change of the unit conversion must not change what was delivered or invoiced.
        $fixedBase = self::str($line['_base_quantity'] ?? null);
        $baseQty = $fixedBase ?? ($unit === $item->baseUnitId ? $qty : $this->units->convert($qty, $unit, $item->baseUnitId, $item->id, 6));
        $lineWarehouse = self::str($line['warehouse_id'] ?? null);
        $this->assertWarehouse($lineWarehouse, "{$field}.warehouse_id");

        if ($options->requireWarehouse && $item->type === 'stock' && ($lineWarehouse ?? $warehouse) === null) {
            Messages::fail('warehouse_id', 'warehouse_required');
        }

        $resolved = null;
        $override = null;
        $given = self::str($line['unit_price'] ?? null);
        $discountPercent = self::str($line['discount_percent'] ?? null);
        $taxInclusive = isset($line['tax_inclusive']) ? (bool) $line['tax_inclusive'] : null;

        if (($line['_fixed'] ?? false) === true) {
            $price = $given ?? '0';
            $source = 'source';
        } else {
            $quote = $this->prices->resolve($item->id, $variant, $party->id, $qty, $unit, $day, $currency);
            $resolved = $quote->toArray();

            if ($given === null) {
                if ($quote->unitPrice === null) {
                    Messages::fail("{$field}.unit_price", 'price_missing', ['item' => $item->code]);
                }

                $price = $quote->unitPrice;
                $source = $quote->source->value;
                $discountPercent ??= $quote->discountPercent;
                $taxInclusive ??= $quote->taxInclusive;
            } else {
                $price = $given;
                $source = 'manual';

                if ($quote->unitPrice !== null && ! BigDecimal::of($quote->unitPrice)->isEqualTo($given)) {
                    $override = ['line' => $i, 'resolved' => $quote->unitPrice, 'given' => Sales::qty($given)];

                    if (! $options->canOverridePrice && $options->strict) {
                        Messages::fail("{$field}.unit_price", 'price_override_forbidden');
                    }
                } else {
                    $source = $quote->unitPrice === null ? 'manual' : $quote->source->value;
                    $discountPercent ??= $quote->discountPercent;
                    $taxInclusive ??= $quote->taxInclusive;
                }
            }
        }

        [$taxCodeId, $rate] = $this->tax($line, $item, $day, $field);
        $discountAmount = Sales::money(self::str($line['discount_amount'] ?? null) ?? '0');
        $discountPercent = (string) BigDecimal::of($discountPercent ?? '0')->toScale(4, RoundingMode::HalfUp);
        $taxInclusive ??= false;

        $row = [
            'line_no' => $i + 1,
            'item_id' => $item->id,
            'variant_id' => $variant,
            'item_type' => $item->type,
            'description' => self::str($line['description'] ?? null) ?? mb_substr($item->name, 0, 500),
            'quantity' => $qty,
            'unit_id' => $unit,
            'base_quantity' => Sales::qty($baseQty),
            'unit_price' => Sales::qty($price),
            'tax_inclusive' => $taxInclusive,
            'discount_percent' => $discountPercent,
            'discount_amount' => $discountAmount,
            'tax_code_id' => $taxCodeId,
            'tax_rate' => $rate,
            'warehouse_id' => $lineWarehouse,
            'source_line_id' => self::str($line['source_line_id'] ?? null),
            'price_source' => $source,
        ];

        return [$row, new LineInput($qty, Sales::qty($price), $discountPercent, $discountAmount, $rate, $taxInclusive, $taxCodeId), $resolved, $override];
    }

    private function item(?string $itemId, string $field): ItemData
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
     * The line's tax code (explicit, explicit null = untaxed, else the item default) and its rate at the date.
     *
     * @param  array<string, mixed>  $line
     * @return array{0: string|null, 1: string}
     */
    private function tax(array $line, ItemData $item, DateTimeImmutable $day, string $field): array
    {
        $code = array_key_exists('tax_code_id', $line) ? self::str($line['tax_code_id']) : $item->defaultTaxCodeId;

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

    private function fxRate(string $currency, string $base, DateTimeImmutable $day, ?string $given): string
    {
        if ($currency === $base) {
            return '1.000000';
        }

        if ($given !== null) {
            if (! BigDecimal::of($given)->isPositive()) {
                Messages::fail('fx_rate', 'fx_rate_invalid');
            }

            return Sales::qty($given);
        }

        try {
            return Sales::qty($this->rates->rate($currency, $base, $day));
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

    /**
     * Default billing address of the party.
     *
     * @return array<string, mixed>|null
     */
    private function billingAddress(string $partyId): ?array
    {
        return $this->addresses->billingAddress($partyId);
    }

    private static function str(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string) $value;
        }

        return is_string($value) && $value !== '' ? $value : null;
    }
}
