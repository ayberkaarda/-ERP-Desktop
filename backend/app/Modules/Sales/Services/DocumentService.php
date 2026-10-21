<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Documents\InvalidStateTransition;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesLine;
use App\Modules\Sales\Services\Composer\Composed;
use App\Modules\Sales\Services\Composer\ComposeOptions;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use BackedEnum;
use Brick\Math\RoundingMode;
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
     * @template T of SalesDocument
     *
     * @param  T  $doc
     * @return T
     */
    protected function lock(SalesDocument $doc, ?int $version = null): SalesDocument
    {
        /** @var T $locked */
        $locked = $doc->newQuery()->whereKey($doc->getKey())->lockForUpdate()->firstOrFail();

        if ($version !== null) {
            $locked->assertVersion($version);
        }

        return $locked;
    }

    /**
     * @param  list<BackedEnum>  $allowed
     */
    protected function assertStatus(SalesDocument $doc, array $allowed, string $to): void
    {
        $status = $doc->currentStatus();

        foreach ($allowed as $case) {
            if ($case->value === $status) {
                return;
            }
        }

        throw new InvalidStateTransition($status, $to);
    }

    protected function assertDraft(SalesDocument $doc): void
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
    protected function mergedHeader(SalesDocument $doc, array $data): array
    {
        $stored = [];

        foreach (SalesDocument::HEADER as $column) {
            $value = $doc->getAttribute($column);
            $stored[$column] = $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : ($value === null ? null : (string) $value);
        }

        $stored['billing_address'] = $doc->billing_address;

        // A new party or currency re-derives what depended on it unless the payload sets it.
        if (array_key_exists('party_id', $data) && $data['party_id'] !== $doc->party_id) {
            unset($stored['payment_term_id'], $stored['price_list_id'], $stored['billing_address'], $stored['due_date']);
        }

        if (array_key_exists('currency_code', $data) && $data['currency_code'] !== $doc->currency_code) {
            unset($stored['fx_rate']);
        }

        if (array_key_exists('document_date', $data) && ! array_key_exists('due_date', $data)) {
            unset($stored['due_date']);
        }

        return [...$stored, ...array_intersect_key($data, array_flip([...SalesDocument::HEADER, 'billing_address']))];
    }

    /**
     * Stored lines as composer input with their prices kept.
     *
     * @param  iterable<SalesLine>  $lines
     * @return list<array<string, mixed>>
     */
    protected function storedLines(iterable $lines): array
    {
        $out = [];

        foreach ($lines as $line) {
            $out[] = $this->fixedLine($line, (string) $line->quantity);
        }

        return $out;
    }

    /**
     * A source line copied at $quantity: same item, unit, price, discount (the absolute discount
     * prorated), stored base quantity (prorated) and tax code; the tax rate is looked up again at the new date unless $keepRate.
     *
     * @return array<string, mixed>
     */
    protected function fixedLine(SalesLine $source, string $quantity, bool $keepRate = false): array
    {
        $discount = $source->discount_amount;

        if (! $discount->isZero() && ! Sales::dec($quantity)->isEqualTo($source->quantity)) {
            $discount = $discount->multipliedBy($quantity)->dividedBy($source->quantity, 2, RoundingMode::HalfUp);
        }

        $base = Sales::dec($quantity)->isEqualTo($source->quantity)
            ? $source->base_quantity
            : $source->base_quantity->multipliedBy($quantity)->dividedBy($source->quantity, 6, RoundingMode::HalfUp);

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
            'description' => $source->description,
            'warehouse_id' => $source->warehouse_id,
            '_fixed' => true,
            '_tax_rate' => $keepRate ? (string) $source->tax_rate : null,
            '_base_quantity' => (string) $base,
        ];
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
    protected function logOverrides(SalesDocument $doc, Composed $composed, ?Authenticatable $actor): void
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
