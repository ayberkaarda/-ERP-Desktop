<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyChild;
use App\Modules\Parties\Support\Messages;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Writes of addresses, contacts and bank accounts. Every write locks the owning party row first,
 * so concurrent writers of one party serialize and the "single default per group" rule (clear the
 * others, then set this one) cannot interleave. Partial unique indexes are the backstop.
 */
final class PartyChildService
{
    public function __construct(private readonly PartyService $parties) {}

    /**
     * @template T of PartyChild
     *
     * @param  class-string<T>  $class
     * @param  array<string, mixed>  $data
     * @return T
     */
    public function create(Party $party, string $class, array $data): PartyChild
    {
        return $this->persist(function () use ($party, $class, $data): PartyChild {
            $this->parties->lock($party);
            $child = new $class;
            $child->fill(array_intersect_key($data, array_flip($class::fields())));
            $child->setAttribute('party_id', $party->id);

            if ($child->isDefault()) {
                $this->clearOtherDefaults($child);
            }

            $child->save();

            return $child;
        });
    }

    /**
     * @template T of PartyChild
     *
     * @param  T  $child
     * @param  array<string, mixed>  $data  validated input including `version`
     * @return T
     */
    public function update(Party $party, PartyChild $child, array $data): PartyChild
    {
        return $this->persist(function () use ($party, $child, $data): PartyChild {
            $this->parties->lock($party);
            /** @var T $locked */
            $locked = $child->newQuery()->whereKey($child->getKey())->lockForUpdate()->firstOrFail();
            $locked->assertVersion((int) $data['version']);
            $locked->fill(array_intersect_key($data, array_flip($locked::fields())));

            if ($locked->isDefault()) {
                $this->clearOtherDefaults($locked);
            }

            $locked->save();

            return $locked;
        });
    }

    public function delete(Party $party, PartyChild $child, int $version): void
    {
        DB::transaction(function () use ($party, $child, $version): void {
            $this->parties->lock($party);
            $locked = $child->newQuery()->whereKey($child->getKey())->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);
            $locked->delete();
        });
    }

    /**
     * Saved one by one so each change is versioned and audited.
     */
    private function clearOtherDefaults(PartyChild $child): void
    {
        $flag = $child::defaultFlag();
        $query = $child->newQuery()->where('party_id', $child->getAttribute('party_id'))->where($flag, true);
        $attributes = $child->getAttributes();

        foreach ($child::defaultGroup() as $column) {
            $query->where($column, $attributes[$column] ?? null);
        }

        if ($child->exists) {
            $query->whereKeyNot($child->getKey());
        }

        foreach ($query->lockForUpdate()->get() as $other) {
            $other->setAttribute($flag, false);
            $other->save();
        }
    }

    /**
     * @template T of PartyChild
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    private function persist(Closure $callback): PartyChild
    {
        try {
            return DB::transaction($callback);
        } catch (UniqueConstraintViolationException $e) {
            if (! str_contains($e->getMessage(), 'party_bank_accounts_party_id_iban_unique')) {
                throw $e;
            }

            $message = Messages::get('iban_taken');

            throw new ApiException(ErrorCode::ValidationError, $message, ['iban' => [$message]], previous: $e);
        }
    }
}
