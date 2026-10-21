<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Core\Company\CompanyContext;
use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Reference\Data\RecordData;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\Project;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class ReferenceWriter
{
    public function __construct(private readonly ExternalReferences $external) {}

    public function save(Model $record, RecordData $data, ?string $warehouseId = null): Model
    {
        return DB::transaction(function () use ($record, $data, $warehouseId): Model {
            // Serialize trees, defaults and first-time activations within a company.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['reference:'.app(CompanyContext::class)->id()]);
            if ($record->exists) {
                $locked = $record->newQuery()->whereKey($record->getKey())->lockForUpdate()->firstOrFail();
                if (! $record instanceof Currency && method_exists($locked, 'assertVersion')) {
                    $locked->assertVersion($data->version ?? 0);
                }
            }
            if ($record instanceof Currency) {
                $activation = CompanyCurrency::query()->firstOrNew(['currency_code' => $record->getAttribute('code')]);
                if ($activation->exists) {
                    $activation->assertVersion($data->version ?? 0);
                } elseif ($data->version !== 1) {
                    throw new VersionConflictException($data->version ?? 0, 1);
                }
                $activation->fill($data->attributes)->save();

                return $record->refresh();
            }
            if ($record instanceof TaxCode) {
                if ($record->exists && $record->getAttribute('company_id') === null) {
                    throw new ApiException(ErrorCode::Forbidden);
                }
                $record->setAttribute('company_id', app(CompanyContext::class)->id());
            }
            if ($record->exists) {
                if (! method_exists($record, 'assertVersion')) {
                    throw new ApiException(ErrorCode::VersionConflict);
                }
                $record->assertVersion($data->version ?? 0);
            }
            $attributes = $data->attributes;
            if ($record instanceof ExchangeRate) {
                DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['reference:manual:'.($attributes['currency_code'] ?? '').':'.($attributes['rate_date'] ?? '')]);
                if (! Currency::query()->where('code', $attributes['currency_code'] ?? $record->getAttribute('currency_code'))->where('is_active', true)->exists()) {
                    $this->invalid('currency_code');
                }
                $attributes['source'] = 'manual';
            }
            if ($record instanceof Location) {
                $warehouse = Warehouse::query()->whereKey($warehouseId)->lockForUpdate()->firstOrFail();
                $attributes['warehouse_id'] = $warehouse->getKey();
            }
            $resource = array_search($record::class, ReferenceSchema::MODELS, true);
            if (is_string($resource)) {
                // Validate stored + incoming values in their cast (not JSON-serialized) form, so partial
                // updates and cross-field rules see the complete record.
                $rules = ReferenceSchema::rules($resource);
                $stored = $record->exists ? array_intersect_key($record->attributesToArray(), $rules) : [];
                Validator::make([...$stored, ...$attributes], $rules)->validate();
            }
            $record->fill($attributes);
            $this->validateReferences($record);
            if ($record instanceof Warehouse && $record->getAttribute('is_default')) {
                Warehouse::query()->where('is_default', true)->lockForUpdate()->get()->each(function (Warehouse $other) use ($record): void {
                    if ($other->getKey() !== $record->getKey()) {
                        $other->setAttribute('is_default', false)->save();
                    }
                });
            }
            if ($record instanceof ExchangeRate && ! $record->exists && ExchangeRate::query()
                ->where('currency_code', $record->getAttribute('currency_code'))
                ->where('rate_date', $record->getAttribute('rate_date'))->where('source', 'manual')
                ->where('company_id', app(CompanyContext::class)->id())->exists()) {
                $this->invalid('rate_date');
            }
            if ($record instanceof TaxCode) {
                $this->assertNoOverlap($record);
            }
            if ($record->getAttribute('code') !== null) {
                $duplicate = $record->newQuery()->where('code', $record->getAttribute('code'));
                if ($record instanceof TaxCode) {
                    $duplicate->where('company_id', app(CompanyContext::class)->id())
                        ->where('effective_from', $record->getAttribute('effective_from'));
                }
                if ($record instanceof Location) {
                    $duplicate->where('warehouse_id', $record->getAttribute('warehouse_id'));
                }
                if ($record->exists) {
                    $duplicate->whereKeyNot($record->getKey());
                }
                if ($duplicate->exists()) {
                    $this->invalid('code');
                }
            }
            $record->save();

            return $record->refresh();
        });
    }

    public function delete(Model $record, int $version): void
    {
        DB::transaction(function () use ($record, $version): void {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['reference:'.app(CompanyContext::class)->id()]);
            $locked = $record->newQuery()->whereKey($record->getKey())->lockForUpdate()->firstOrFail();
            if ($record instanceof Currency || $record instanceof ExchangeRate || ($record instanceof TaxCode && $record->getAttribute('company_id') === null)) {
                throw new ApiException(ErrorCode::Forbidden);
            }
            if (method_exists($locked, 'assertVersion')) {
                $locked->assertVersion($version);
            }
            if ($record instanceof CostCenter && (CostCenter::query()->where('parent_id', $record->getKey())->exists()
                || Project::query()->where('cost_center_id', $record->getKey())->exists())) {
                $this->invalid('is_active');
            }
            if ($record instanceof Warehouse && $this->external->warehouseHasMovements((string) $record->getKey())) {
                // The stock ledger is append-only: a warehouse with movements is deactivated instead.
                throw ValidationException::withMessages(['is_active' => [__('reference::messages.warehouse_has_movements')]]);
            }
            if ($record instanceof Warehouse && Location::query()->where('warehouse_id', $record->getKey())->exists()) {
                $this->invalid('is_active');
            }
            if ($record instanceof Location && Location::query()->where('parent_id', $record->getKey())->exists()) {
                $this->invalid('is_active');
            }
            $record->delete();
        });
    }

    private function validateReferences(Model $record): void
    {
        $parent = $record->getAttribute('parent_id');
        if ($parent !== null && ($record instanceof CostCenter || $record instanceof Location)) {
            $seen = [(string) $record->getKey()];
            while ($parent !== null) {
                if (in_array($parent, $seen, true)) {
                    $this->invalid('parent_id');
                }
                $seen[] = $parent;
                $ancestor = $record->newQuery()->whereKey($parent)->lockForUpdate()->first();
                if ($ancestor === null || ($record instanceof Location && $ancestor->getAttribute('warehouse_id') !== $record->getAttribute('warehouse_id'))) {
                    $this->invalid('parent_id');
                }
                $parent = $ancestor->getAttribute('parent_id');
            }
        }
        $costCenter = $record->getAttribute('cost_center_id');
        if ($costCenter !== null && ! CostCenter::query()->whereKey($costCenter)->where('is_active', true)->exists()) {
            $this->invalid('cost_center_id');
        }
        $branch = $record->getAttribute('branch_id');
        if (is_string($branch) && ! $this->external->branchExists($branch)) {
            $this->invalid('branch_id');
        }
        $party = $record->getAttribute('party_id');
        if (is_string($party) && ! $this->external->partyExists($party)) {
            $this->invalid('party_id');
        }
    }

    /** One rate per code and scope on any day; the DB exclusion constraint backs this up under races. */
    private function assertNoOverlap(TaxCode $record): void
    {
        $from = (string) $record->getAttribute('effective_from');
        $to = $record->getAttribute('effective_to');
        $overlap = TaxCode::query()->withoutGlobalScope('visible')
            ->where('company_id', $record->getAttribute('company_id'))
            ->where('code', $record->getAttribute('code'))
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>=', $from))
            ->when(is_string($to), fn ($q) => $q->where('effective_from', '<=', $to))
            ->when($record->exists, fn ($q) => $q->whereKeyNot($record->getKey()))
            ->exists();
        if ($overlap) {
            $this->invalid('effective_from');
        }
    }

    private function invalid(string $field): never
    {
        throw ValidationException::withMessages([$field => [__('reference::messages.invalid_reference')]]);
    }
}
