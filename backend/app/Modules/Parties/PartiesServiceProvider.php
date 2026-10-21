<?php

declare(strict_types=1);

namespace App\Modules\Parties;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Contracts\PartyUsageChecker;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyAddress;
use App\Modules\Parties\Models\PartyBankAccount;
use App\Modules\Parties\Models\PartyContact;
use App\Modules\Parties\Policies\PartyPolicy;
use App\Modules\Parties\Services\EloquentPartyLookup;
use App\Modules\Parties\Services\PartyCodeGenerator;
use App\Modules\Parties\Services\TaggedPartyUsageChecker;
use App\Modules\Parties\Support\ReferenceGuards;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Gate;

/**
 * Parties: customers and suppliers of a company, with addresses, contacts and bank accounts.
 *
 * - Codes: Core NumberSequenceService, doc type `party`, series `P`, format numbering.formats.party
 *   (default `{series}{seq:6}`), drawn inside the creating transaction.
 * - Tax numbers: VKN for Turkish companies, TCKN for Turkish persons, free form abroad; unique per
 *   company among active, non-deleted parties on the canonical form (tax_number_canonical: upper
 *   case, no spaces, dots, hyphens or slashes; partial unique index), 422 on field tax_number.
 * - Foreign references (default_currency_code, risk_currency_code, payment_term_id, price_list_id,
 *   bank account currency_code) are plain columns without foreign keys. Support\ReferenceGuards
 *   checks them through Reference\Contracts\CurrencyLookup / PaymentTermLookup and
 *   Catalog\Contracts\PriceListLookup (`exists()`, in the active company). A reference that cannot
 *   be verified (module not installed) is a validation error unless config
 *   parties.allow_unverified_references is on (config/parties.php, default off).
 * - Audit: bank account IBANs are masked (country + last 4) in activity log entries.
 * - Deletion: soft delete when no PartyUsageChecker reports the party in use, otherwise the party
 *   is deactivated (is_active = false). Modules that reference parties tag their checker with
 *   PartyUsageChecker::TAG.
 * - Contracts for other modules: PartyLookup (readonly PartyData), PartyUsageChecker; events
 *   PartyCreated / PartyUpdated are dispatched after commit.
 */
final class PartiesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/config/parties.php', 'parties');
        $this->app->bind(PartyLookup::class, EloquentPartyLookup::class);
        $this->app->bind(PartyUsageChecker::class, TaggedPartyUsageChecker::class);
        $this->app->bind(ReferenceGuards::class, static fn ($app): ReferenceGuards => new ReferenceGuards($app));

        $config = $this->app->make('config');

        if (! is_string($config->get('numbering.formats.'.PartyCodeGenerator::DOC_TYPE))) {
            $config->set('numbering.formats.'.PartyCodeGenerator::DOC_TYPE, PartyCodeGenerator::DEFAULT_FORMAT);
        }
    }

    public function boot(): void
    {
        parent::boot();

        Gate::policy(Party::class, PartyPolicy::class);
        Relation::morphMap([
            'party' => Party::class,
            'party_address' => PartyAddress::class,
            'party_contact' => PartyContact::class,
            'party_bank_account' => PartyBankAccount::class,
        ]);
    }
}
