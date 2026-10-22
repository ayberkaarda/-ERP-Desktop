<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Documents\HasStatus;
use App\Core\Documents\InvalidStateTransition;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseLine;
use App\Modules\Purchasing\Services\Composer\Composed;
use App\Modules\Purchasing\Services\Composer\ComposeOptions;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use BackedEnum;
use Brick\Math\RoundingMode;
use DateTimeInterface;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

/**
 * Shared steps of the document services: row locks, status guards, draft edits and line inputs.
 */
abstract class DocumentService
{
    public function __construct(
        protected readonly DocumentComposer $composer,
        protected readonly DocumentStore $store,
    ) {}

    /**
     * Re-reads the document under a row lock (company scoped, so a foreign id is a 404).
     *
     * @template T of Model
     *
     * @param  T  $doc
     * @return T
     */
    protected function lock(Model $doc, ?int $version = null): Model
    {
        /** @var T $locked */
        $locked = $doc->newQuery()->whereKey($doc->getKey())->lockForUpdate()->firstOrFail();

        if ($version !== null && method_exists($locked, 'assertVersion')) {
            $locked->assertVersion($version);
        }

        return $locked;
    }

    /**
     * @param  list<BackedEnum>  $allowed
     */
    protected function assertStatus(HasStatus $doc, array $allowed, string $to): void
    {
        $status = $doc->currentStatus();

        foreach ($allowed as $case) {
            if ($case->value === $status) {
                return;
            }
        }

        throw new InvalidStateTransition($status, $to);
    }

    protected function assertDraft(HasStatus $doc): void
    {
        if ($doc->currentStatus() !== 'draft') {
            throw new ApiException(ErrorCode::InvalidStateTransition, Messages::get('document_not_editable'));
        }
    }

    /**
     * Header input of a stored draft merged with a PATCH payload.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    protected function mergedHeader(PurchaseDocument $doc, array $data): array
    {
        $stored = [];

        foreach (PurchaseDocument::HEADER as $column) {
            $value = $doc->getAttribute($column);
            $stored[$column] = $value instanceof DateTimeInterface ? $value->format('Y-m-d') : ($value === null ? null : (string) $value);
        }

        $stored['billing_address'] = $doc->billing_address;

        // A new supplier or currency re-derives what depended on it unless the payload sets it.
        if (array_key_exists('party_id', $data) && $data['party_id'] !== $doc->party_id) {
            unset($stored['payment_term_id'], $stored['billing_address'], $stored['due_date']);
        }

        if (array_key_exists('currency_code', $data) && $data['currency_code'] !== $doc->currency_code) {
            unset($stored['fx_rate']);
        }

        if (array_key_exists('document_date', $data) && ! array_key_exists('due_date', $data)) {
            unset($stored['due_date']);
        }

        return [...$stored, ...array_intersect_key($data, array_flip([...PurchaseDocument::HEADER, 'billing_address']))];
    }

    /**
     * Composer input and line ids for a draft edit. Without lines the stored lines stay as they are.
     * A line carrying the id of a stored line keeps that row and, while its item, variant and unit
     * stay, its provenance (and the source price a source-linked line is compared with).
     *
     * @param  iterable<PurchaseLine>  $stored
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>} composer lines and per-line extras (id)
     */
    protected function editedLines(iterable $stored, ?array $lines): array
    {
        $byId = [];

        foreach ($stored as $line) {
            $byId[$line->id] = $line;
        }

        if ($lines === null) {
            return [
                array_values(array_map(fn (PurchaseLine $l): array => $this->keptLine($l, (string) $l->quantity), $byId)),
                array_values(array_map(static fn (PurchaseLine $l): array => ['id' => $l->id], $byId)),
            ];
        }

        $inputs = [];
        $extras = [];

        foreach ($lines as $i => $line) {
            $id = is_string($line['id'] ?? null) ? $line['id'] : null;
            unset($line['id']);

            if ($id === null) {
                $inputs[] = $line;
                $extras[] = [];

                continue;
            }

            $old = $byId[$id] ?? Messages::fail("lines.{$i}.id", 'line_unknown');
            $same = ($line['item_id'] ?? null) === $old->item_id
                && ($line['variant_id'] ?? $old->variant_id) === $old->variant_id
                && ($line['unit_id'] ?? $old->unit_id) === $old->unit_id;

            if ($same) {
                $kept = $this->keptLine($old, is_string($line['quantity'] ?? null) ? $line['quantity'] : (string) $old->quantity);

                foreach (['unit_price', 'discount_percent', 'discount_amount', 'tax_code_id', 'tax_inclusive', 'withholding_code_id', 'description', 'warehouse_id'] as $key) {
                    if (array_key_exists($key, $line)) {
                        $kept[$key] = $line[$key];

                        if ($key === 'tax_code_id') {
                            unset($kept['_tax_rate']);
                        }

                        if ($key === 'withholding_code_id') {
                            unset($kept['_withholding_rate']);
                        }
                    }
                }

                $inputs[] = $kept;
            } else {
                $inputs[] = $line;
            }

            $extras[] = ['id' => $id];
        }

        return [$inputs, $extras];
    }

    /**
     * A stored line as composer input: its price, discount, provenance and price source kept. A
     * line that came from a source keeps comparing its price with what the source carried.
     *
     * @return array<string, mixed>
     */
    protected function keptLine(PurchaseLine $line, string $quantity): array
    {
        $kept = [...$this->fixedLine($line, $quantity), 'source_line_id' => $line->source_line_id, '_price_source' => $line->price_source];
        unset($kept['_tax_rate'], $kept['_withholding_rate']);

        if ($line->source_line_id === null || $line->price_source === 'manual') {
            unset($kept['_source_price']);
            $kept['_fixed'] = $line->source_line_id !== null;
        }

        return $kept;
    }

    /**
     * A source line copied at $quantity: same item, unit, price, discount (the absolute discount
     * prorated), stored base quantity (prorated) and tax codes; rates are looked up again at the new
     * date unless $keepRate.
     *
     * @return array<string, mixed>
     */
    protected function fixedLine(PurchaseLine $source, string $quantity, bool $keepRate = false): array
    {
        $discount = $source->discount_amount;
        $same = Purchasing::dec($quantity)->isEqualTo($source->quantity);

        if (! $discount->isZero() && ! $same) {
            $discount = $discount->multipliedBy($quantity)->dividedBy($source->quantity, 2, RoundingMode::HalfUp);
        }

        $base = $same ? $source->base_quantity : $source->base_quantity->multipliedBy($quantity)->dividedBy($source->quantity, 6, RoundingMode::HalfUp);

        return [
            'item_id' => $source->item_id,
            'variant_id' => $source->variant_id,
            'unit_id' => $source->unit_id,
            'quantity' => $quantity,
            'unit_price' => (string) $source->unit_price,
            'discount_percent' => (string) $source->discount_percent,
            'discount_amount' => (string) $discount,
            'tax_code_id' => $source->tax_code_id,
            'tax_inclusive' => $source->tax_inclusive,
            'withholding_code_id' => $source->withholding_code_id,
            'description' => $source->description,
            'warehouse_id' => $source->warehouse_id,
            '_fixed' => true,
            '_source_price' => (string) $source->unit_price,
            '_tax_rate' => $keepRate ? (string) $source->tax_rate : null,
            '_withholding_rate' => $keepRate ? (string) $source->withholding_rate : null,
            '_base_quantity' => (string) $base,
        ];
    }

    /**
     * A source line with a client price applied (a different price is an override, checked by the composer).
     *
     * @param  array<string, mixed>  $line  client line (unit_price optional)
     * @return array<string, mixed>
     */
    protected function sourcedLine(PurchaseLine $source, string $quantity, array $line): array
    {
        $input = [...$this->fixedLine($source, $quantity), 'source_line_id' => $source->id];
        $price = $line['unit_price'] ?? null;

        if (is_string($price) && $price !== '') {
            $input['unit_price'] = $price;
        }

        return $input;
    }

    /**
     * @param  array<string, mixed>  $header
     * @param  list<array<string, mixed>>  $lines
     */
    protected function compose(array $header, array $lines, bool $canOverridePrice, bool $requireWarehouse = false): Composed
    {
        if ($lines === []) {
            Messages::fail('lines', 'lines_required');
        }

        return $this->composer->compose($header, $lines, new ComposeOptions($canOverridePrice, true, $requireWarehouse));
    }

    /** Price overrides are audited on the document. */
    protected function logOverrides(PurchaseDocument $doc, Composed $composed, ?Authenticatable $actor): void
    {
        if ($composed->priceOverrides === []) {
            return;
        }

        activity()->performedOn($doc)->causedBy(self::causer($actor))->withProperties(['overrides' => $composed->priceOverrides])->event('price_override')->log('price_override');
    }

    /** The acting user as activity causer (a model), or nobody. */
    protected static function causer(?Authenticatable $actor): ?Model
    {
        return $actor instanceof Model ? $actor : null;
    }

    protected static function actorId(?Authenticatable $actor): ?string
    {
        $id = $actor?->getAuthIdentifier();

        return is_string($id) ? $id : null;
    }
}
