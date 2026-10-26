<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Rules\ClientKey;
use App\Modules\Parties\Contracts\PartyUsageChecker;
use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Events\PartyCreated;
use App\Modules\Parties\Events\PartyUpdated;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Support\Messages;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Stateless apart from its collaborators: controllers are reused across requests, so the active
 * company is read per call, never captured.
 */
final class PartyService
{
    public function __construct(
        private readonly PartyCodeGenerator $codes,
        private readonly PartyUsageChecker $usage,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated input
     */
    public function create(array $data): Party
    {
        return $this->persist(function () use ($data): Party {
            $party = new Party;
            if (isset($data['id']) && is_string($data['id'])) {
                $party->id = $data['id'];
            }
            $party->fill($this->clean($data));
            $party->code = $this->codes->next(app(CompanyContext::class)->id());
            $party->save();

            event(new PartyCreated($party->id, $party->company_id));

            return $party;
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated input including `version`
     */
    public function update(Party $party, array $data): Party
    {
        return $this->persist(function () use ($party, $data): Party {
            $locked = $this->lock($party);
            $locked->assertVersion((int) $data['version']);
            $locked->fill($this->clean($data));
            $changed = array_keys($locked->getDirty());
            $locked->save();

            if ($changed !== []) {
                event(new PartyUpdated($locked->id, $locked->company_id, array_values(array_diff($changed, ['version', 'updated_at']))));
            }

            return $locked;
        });
    }

    /**
     * Soft deletes an unused party; a party still referenced elsewhere is deactivated instead.
     *
     * @return Party|null the deactivated party, or null when it was deleted
     */
    public function delete(Party $party, int $version): ?Party
    {
        return DB::transaction(function () use ($party, $version): ?Party {
            $locked = $this->lock($party);
            $locked->assertVersion($version);

            if (! $this->usage->isInUse($locked->company_id, $locked->id)) {
                $locked->delete();

                return null;
            }

            if ($locked->is_active) {
                $locked->is_active = false;
                $locked->save();
                event(new PartyUpdated($locked->id, $locked->company_id, ['is_active']));
            }

            return $locked;
        });
    }

    public function lock(Party $party): Party
    {
        return Party::query()->whereKey($party->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function clean(array $data): array
    {
        $data = array_intersect_key($data, array_flip(Party::FIELDS));

        if (isset($data['roles']) && is_array($data['roles'])) {
            $data['roles'] = PartyRole::normalize($data['roles']);
        }

        if (array_key_exists('tags', $data)) {
            $data['tags'] = is_array($data['tags']) ? array_values(array_unique($data['tags'])) : [];
        }

        return $data;
    }

    /**
     * @param  Closure(): Party  $callback
     */
    private function persist(Closure $callback): Party
    {
        try {
            return DB::transaction($callback);
        } catch (UniqueConstraintViolationException $e) {
            // A client-supplied id can pass the unique rule and still lose the insert race.
            [$field, $message] = match (true) {
                str_contains($e->getMessage(), 'parties_company_tax_number_unique') => ['tax_number', Messages::get('tax_number_taken')],
                str_contains($e->getMessage(), 'parties_pkey') => ['id', ClientKey::message()],
                default => throw $e,
            };

            throw new ApiException(ErrorCode::ValidationError, $message, [$field => [$message]], previous: $e);
        }
    }
}
