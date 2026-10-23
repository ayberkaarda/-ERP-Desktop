<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Services;

use App\Core\Numbering\NumberSequenceService;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Contracts\PaymentReversalGuard;
use App\Modules\Treasury\Contracts\TreasuryAccountLookup;
use App\Modules\Treasury\Contracts\TreasuryInvoiceAccess;
use App\Modules\Treasury\Contracts\TreasuryMovementLookup;
use App\Modules\Treasury\Contracts\TreasuryMovementWriter;
use App\Modules\Treasury\Instruments\Enums\InstrumentAction;
use App\Modules\Treasury\Instruments\Enums\InstrumentDirection;
use App\Modules\Treasury\Instruments\Enums\InstrumentKind;
use App\Modules\Treasury\Instruments\Enums\InstrumentStatus;
use App\Modules\Treasury\Instruments\Models\Instrument;
use App\Modules\Treasury\Support\Treasury;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Instruments
{
    public function __construct(
        private readonly PostingService $posting,
        private readonly AccountDeterminer $determiner,
        private readonly PeriodGuard $periods,
        private readonly TreasuryInvoiceAccess $invoices,
        private readonly TreasuryAccountLookup $accounts,
        private readonly TreasuryMovementWriter $movements,
    ) {}

    /** @param array<string, mixed> $input */
    public function create(array $input): Instrument
    {
        return DB::transaction(function () use ($input): Instrument {
            $this->validateHeader($input);
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['treasury.instrument.'.Extension::company().'.'.$input['kind'].'.'.$input['direction'].'.'.$input['instrument_number']]);
            if (Instrument::query()->where('kind', $input['kind'])->where('direction', $input['direction'])->where('instrument_number', $input['instrument_number'])->exists()) {
                Extension::fail('instrument_number', 'duplicate_instrument');
            }
            $instrument = new Instrument(array_diff_key($input, ['allocations' => true]));
            $instrument->setAttribute('created_by', request()->user()?->getAuthIdentifier());
            $instrument->save();
            $this->saveAllocations($instrument, $input['allocations'] ?? [], 'origin');

            return $instrument;
        });
    }

    /** @param array<string, mixed> $input */
    public function update(string $id, int $version, array $input): Instrument
    {
        return DB::transaction(function () use ($id, $version, $input): Instrument {
            $instrument = $this->lock($id, $version);
            if ($instrument->status !== InstrumentStatus::Draft->value) {
                Extension::fail('status', 'invalid_transition');
            }
            $all = [...$instrument->toArray(), ...$input];
            $this->validateHeader($all);
            $instrument->fill(array_diff_key($input, ['allocations' => true]));
            $instrument->save();
            if (array_key_exists('allocations', $input)) {
                DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $id)->delete();
                $this->saveAllocations($instrument, $input['allocations'], 'origin');
            }

            return $instrument;
        });
    }

    public function delete(string $id, int $version): void
    {
        DB::transaction(function () use ($id, $version): void {
            $instrument = $this->lock($id, $version);
            if ($instrument->status !== InstrumentStatus::Draft->value) {
                Extension::fail('status', 'invalid_transition');
            }
            DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $id)->delete();
            $instrument->delete();
        });
    }

    /** @return array<string, mixed> */
    public function detail(Instrument $instrument): array
    {
        $this->authorizeSources($instrument);

        return [...$instrument->toArray(),
            'allocations' => DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $instrument->id)->orderBy('id')->get()->map(static fn (object $row): array => (array) $row)->all(),
            'events' => DB::table('treasury_instrument_events')->where('company_id', Extension::company())->where('instrument_id', $instrument->id)->orderBy('sequence')->get()->map(static fn (object $row): array => (array) $row)->all(),
        ];
    }

    public function authorizeSources(Instrument $instrument): void
    {
        $modules = DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $instrument->id)->distinct()->pluck('invoice_module');
        foreach ($modules as $module) {
            Extension::authorize($module === 'sales' ? 'sales.invoices.view' : 'purchasing.invoices.view');
        }
    }

    /** @param array<string, mixed> $input */
    public function act(string $id, string $action, int $version, array $input): Instrument
    {
        return DB::transaction(function () use ($id, $action, $version, $input): Instrument {
            $instrument = $this->lock($id, $version);
            $date = Extension::date((string) $input['document_date']);
            if ($date < $instrument->issue_date) {
                Extension::fail('document_date', 'invalid_date');
            }
            $lastDate = DB::table('treasury_instrument_events')->where('company_id', Extension::company())->where('instrument_id', $id)->max('document_date');
            if (is_string($lastDate) && $date < $lastDate) {
                Extension::fail('document_date', 'invalid_date');
            }
            $this->periods->assertOpen(Extension::company(), new DateTimeImmutable($date));
            $from = $instrument->status;
            $entry = null;
            $movementId = null;
            $metadata = [];
            $sequence = 1 + (int) DB::table('treasury_instrument_events')->where('company_id', Extension::company())->where('instrument_id', $id)->max('sequence');
            if ($action === InstrumentAction::Receive->value || $action === InstrumentAction::Issue->value) {
                if ($from !== InstrumentStatus::Draft->value || ($action === InstrumentAction::Receive->value) !== ($instrument->direction === InstrumentDirection::Received->value)) {
                    Extension::fail('status', 'invalid_transition');
                }
                $instrument->number = app(NumberSequenceService::class)->next(Extension::company(), 'treasury_instrument', 'TIN', (int) substr($date, 0, 4));
                $instrument->setAttribute('portfolio_account_id', $this->determiner->resolve($this->portfolioEvent($instrument))->id);
                $instrument->local_amount = $this->local(BigDecimal::of($instrument->amount)->multipliedBy($instrument->fx_rate));
                $lines = [$this->portfolioLine($instrument, $this->portfolioEvent($instrument), $instrument->direction === InstrumentDirection::Received->value)];
                array_push($lines, ...$this->settle($instrument, 'origin', $instrument->party_id, $date, $instrument->direction === InstrumentDirection::Issued->value));
                $entry = $this->journal($instrument, $date, $sequence.'.'.$action, $lines);
                $instrument->journal_entry_id = $entry->id;
                $instrument->status = $action === InstrumentAction::Receive->value ? InstrumentStatus::Portfolio->value : InstrumentStatus::Issued->value;
            } elseif ($action === InstrumentAction::Collect->value) {
                $this->receivedPortfolio($instrument);
                $collectionAccount = $this->determiner->resolve('treasury.collection')->id;
                $entry = $this->journal($instrument, $date, $sequence.'.collect', [
                    new PostingLine(accountId: $collectionAccount, debit: $instrument->local_amount, partyId: $instrument->party_id,
                        currency: $instrument->currency_code, fxAmount: $instrument->amount, fxRate: $instrument->fx_rate),
                    $this->portfolioLine($instrument, $this->portfolioEvent($instrument), false),
                ]);
                $metadata = ['collection_account_id' => $collectionAccount];
                $instrument->status = InstrumentStatus::Collection->value;
            } elseif ($action === InstrumentAction::Pledge->value || $action === InstrumentAction::Release->value) {
                if ($action === InstrumentAction::Pledge->value) {
                    $this->receivedPortfolio($instrument);
                    $instrument->status = InstrumentStatus::Pledged->value;
                } elseif ($from === InstrumentStatus::Pledged->value) {
                    $instrument->status = InstrumentStatus::Portfolio->value;
                } else {
                    Extension::fail('status', 'invalid_transition');
                }
            } elseif ($action === InstrumentAction::Endorse->value) {
                $this->receivedPortfolio($instrument);
                $partyId = (string) $input['party_id'];
                $party = app(PartyLookup::class)->find($partyId);
                if ($party === null || ! $party->isActive || ! $party->isSupplier()) {
                    Extension::fail('party_id', 'invalid_party');
                }
                $this->saveAllocations($instrument, $input['allocations'] ?? [], 'endorse');
                $lines = $this->settle($instrument, 'endorse', $partyId, $date, true);
                $lines[] = $this->portfolioLine($instrument, $this->portfolioEvent($instrument), false);
                $entry = $this->journal($instrument, $date, $sequence.'.endorse', $lines);
                $instrument->status = InstrumentStatus::Endorsed->value;
                $metadata = ['party_id' => $partyId];
            } elseif ($action === InstrumentAction::Clear->value) {
                if (! in_array($from, [InstrumentStatus::Portfolio->value, InstrumentStatus::Collection->value, InstrumentStatus::Issued->value], true)) {
                    Extension::fail('status', 'invalid_transition');
                }
                $accountId = (string) $input['account_id'];
                DB::table('treasury_accounts')->where('company_id', Extension::company())->where('id', $accountId)->lockForUpdate()->first();
                $account = $this->accounts->find($accountId);
                if ($account === null || ! $account->isActive || $account->currencyCode !== $instrument->currency_code) {
                    Extension::fail('account_id', 'invalid_account');
                }
                $base = app(SettingsReader::class)->get('company.base_currency');
                $rate = $instrument->currency_code === $base ? '1' : app(ExchangeRateProvider::class)->rate($instrument->currency_code, is_string($base) ? $base : 'TRY', new DateTimeImmutable($date));
                $bankLocal = $this->local(BigDecimal::of($instrument->amount)->multipliedBy($rate));
                $received = $instrument->direction === InstrumentDirection::Received->value;
                $bankLine = new PostingLine(accountId: $account->glAccountId, debit: $received ? $bankLocal : '0', credit: $received ? '0' : $bankLocal,
                    currency: $instrument->currency_code, fxAmount: $instrument->amount, fxRate: $rate);
                $entry = $this->journal($instrument, $date, $sequence.'.clear', [
                    $bankLine, $this->portfolioLine($instrument, $from === InstrumentStatus::Collection->value ? 'treasury.collection' : $this->portfolioEvent($instrument), ! $received),
                ]);
                $signed = BigDecimal::of($instrument->amount)->multipliedBy($received ? 1 : -1);
                $movement = $this->movements->record($accountId, 'treasury_instrument', $id, $date, Extension::money((string) $signed), Extension::money((string) BigDecimal::of($bankLocal)->multipliedBy($received ? 1 : -1)), $entry->id);
                $movementId = $movement->id;
                $instrument->status = InstrumentStatus::Cleared->value;
            } elseif ($action === InstrumentAction::Dishonour->value || $action === InstrumentAction::Return->value) {
                if (! in_array($from, [InstrumentStatus::Portfolio->value, InstrumentStatus::Collection->value, InstrumentStatus::Pledged->value, InstrumentStatus::Issued->value, InstrumentStatus::Endorsed->value, InstrumentStatus::Cleared->value], true) || trim((string) ($input['reason'] ?? '')) === '') {
                    Extension::fail('status', 'invalid_transition');
                }
                $events = DB::table('treasury_instrument_events')->where('company_id', Extension::company())->where('instrument_id', $id)->orderByDesc('sequence')->get();
                $reversals = [];
                foreach ($events as $event) {
                    if ($event->journal_entry_id !== null) {
                        if ($event->movement_id !== null) {
                            app(TreasuryMovementLookup::class)->findForUpdate((string) $event->movement_id);
                            app(PaymentReversalGuard::class)->assertMovementUnmatched((string) $event->movement_id);
                        }
                        $reversed = $this->posting->reverse((string) $event->journal_entry_id, new DateTimeImmutable($date), (string) $input['reason']);
                        $reversals[] = $reversed->id;
                        if ($event->movement_id !== null) {
                            $movement = DB::table('treasury_movements')->where('company_id', Extension::company())->where('id', $event->movement_id)->first();
                            if ($movement !== null) {
                                $this->movements->record((string) $movement->account_id, 'treasury_instrument_reversal', $id, $date,
                                    Extension::money((string) BigDecimal::of((string) $movement->amount)->negated()), Extension::money((string) BigDecimal::of((string) $movement->local_amount)->negated()), $reversed->id, (string) $movement->id);
                            }
                        }
                    }
                }
                foreach (DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $id)->orderBy('invoice_module')->orderBy('invoice_id')->get() as $allocation) {
                    $this->invoices->unapply((string) $allocation->invoice_module, Extension::company(), (string) $allocation->invoice_id, (string) $allocation->settlement_reference, $date);
                }
                $instrument->status = $action === InstrumentAction::Return->value ? InstrumentStatus::Returned->value : InstrumentStatus::Dishonoured->value;
                $metadata = ['reversal_journal_ids' => $reversals];
            } else {
                Extension::fail('action', 'invalid_transition');
            }
            $instrument->save();
            DB::table('treasury_instrument_events')->insert([
                'id' => (string) Str::uuid7(), 'company_id' => Extension::company(), 'instrument_id' => $id, 'sequence' => $sequence,
                'action' => $action, 'from_status' => $from, 'to_status' => $instrument->status, 'document_date' => $date,
                'journal_entry_id' => $entry?->id, 'movement_id' => $movementId, 'reason' => $input['reason'] ?? null,
                'actor_id' => request()->user()?->getAuthIdentifier(), 'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR), 'created_at' => now(),
            ]);

            return $instrument;
        });
    }

    /** @param array<string, mixed> $input */
    private function validateHeader(array $input): void
    {
        if (Extension::date((string) $input['due_date']) < Extension::date((string) $input['issue_date'])) {
            Extension::fail('due_date', 'invalid_date');
        }
        $party = app(PartyLookup::class)->find((string) $input['party_id']);
        if ($party === null || ! $party->isActive || ($input['direction'] === InstrumentDirection::Received->value ? ! $party->isCustomer() : ! $party->isSupplier())) {
            Extension::fail('party_id', 'invalid_party');
        }
        if (! app(CurrencyLookup::class)->exists((string) $input['currency_code'])) {
            Extension::fail('currency_code', 'invalid_currency');
        }
        $base = app(SettingsReader::class)->get('company.base_currency');
        if ($input['currency_code'] === $base && ! BigDecimal::of((string) $input['fx_rate'])->isEqualTo(1)) {
            Extension::fail('fx_rate', 'invalid_amount');
        }
    }

    private function saveAllocations(Instrument $instrument, mixed $allocations, string $purpose): void
    {
        if (! is_array($allocations)) {
            Extension::fail('allocations', 'invalid_amount');
        }
        $seen = [];
        $sum = BigDecimal::of('0');
        foreach ($allocations as $allocation) {
            if (! is_array($allocation) || ! isset($allocation['invoice_module'], $allocation['invoice_id'], $allocation['amount'])) {
                Extension::fail('allocations', 'invalid_amount');
            }
            $key = $allocation['invoice_module'].':'.$allocation['invoice_id'];
            if (isset($seen[$key])) {
                Extension::fail('allocations', 'duplicate_allocation');
            }
            $seen[$key] = true;
            $sum = $sum->plus((string) $allocation['amount']);
            DB::table('treasury_instrument_allocations')->insert([
                'id' => (string) Str::uuid7(), 'company_id' => Extension::company(), 'instrument_id' => $instrument->id,
                'purpose' => $purpose, 'invoice_module' => $allocation['invoice_module'], 'invoice_id' => $allocation['invoice_id'],
                'amount' => $allocation['amount'], 'settlement_reference' => 'tin:'.$instrument->id.':'.$purpose.':'.$allocation['invoice_id'],
            ]);
        }
        if ($sum->isGreaterThan($instrument->amount)) {
            Extension::fail('allocations', 'invalid_amount');
        }
    }

    /** @return list<PostingLine> */
    private function settle(Instrument $instrument, string $purpose, string $partyId, string $date, bool $debit): array
    {
        $module = $debit ? 'purchasing' : 'sales';
        $event = $debit ? 'purchase.payable' : 'sales.receivable';
        $lines = [];
        $sum = BigDecimal::of('0');
        $allocations = DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('instrument_id', $instrument->id)->where('purpose', $purpose)->orderBy('invoice_module')->orderBy('invoice_id')->get();
        foreach ($allocations as $allocation) {
            $invoice = $this->invoices->findForUpdate((string) $allocation->invoice_module, (string) $allocation->invoice_id);
            if ($invoice === null || $invoice->companyId !== Extension::company() || $invoice->partyId !== $partyId || $invoice->module !== $module || $invoice->invoiceType === 'return' || $invoice->currencyCode !== $instrument->currency_code || BigDecimal::of((string) $allocation->amount)->isGreaterThan($invoice->balanceDue)) {
                Extension::fail('allocations', 'invalid_invoice');
            }
            $amount = BigDecimal::of((string) $allocation->amount);
            if ($invoice->balanceLocal === null || $invoice->controlAccountId === null) {
                throw new \LogicException('Invoice lookup must expose exact carrying amount and original control account.');
            }
            $carrying = $amount->isEqualTo($invoice->balanceDue) ? BigDecimal::of($invoice->balanceLocal)
                : BigDecimal::of($this->local(BigDecimal::of($invoice->balanceLocal)->multipliedBy($amount)->dividedBy($invoice->balanceDue, 12, RoundingMode::HalfUp)));
            $this->invoices->apply($module, Extension::company(), $invoice->id, (string) $amount, (string) $allocation->settlement_reference, $date, (string) $carrying);
            DB::table('treasury_instrument_allocations')->where('company_id', Extension::company())->where('id', $allocation->id)->update(['carrying_local' => Extension::money((string) $carrying)]);
            if (! $carrying->isZero()) {
                $lines[] = new PostingLine(accountId: $invoice->controlAccountId, debit: $debit ? (string) $carrying : '0', credit: $debit ? '0' : (string) $carrying,
                    partyId: $partyId, currency: $instrument->currency_code, fxAmount: (string) $amount, fxRate: $invoice->fxRate);
            }
            $sum = $sum->plus($amount);
        }
        $remainder = BigDecimal::of($instrument->amount)->minus($sum);
        if ($remainder->isPositive()) {
            $lines[] = $this->line($event, $this->local($remainder->multipliedBy($instrument->fx_rate)), $debit, $partyId, $instrument->currency_code, (string) $remainder, $instrument->fx_rate);
        }

        return $lines;
    }

    private function receivedPortfolio(Instrument $instrument): void
    {
        if ($instrument->direction !== 'received' || $instrument->status !== InstrumentStatus::Portfolio->value) {
            Extension::fail('status', 'invalid_transition');
        }
    }

    private function portfolioEvent(Instrument $instrument): string
    {
        return 'treasury.'.($instrument->kind === InstrumentKind::Cheque->value ? 'cheque' : 'note').($instrument->direction === InstrumentDirection::Received->value ? '_portfolio' : '_payable');
    }

    private function portfolioLine(Instrument $instrument, string $event, bool $debit): PostingLine
    {
        $accountId = $instrument->getAttribute('portfolio_account_id');
        if ($event === 'treasury.collection') {
            $metadata = DB::table('treasury_instrument_events')->where('company_id', Extension::company())->where('instrument_id', $instrument->id)
                ->where('action', InstrumentAction::Collect->value)->orderByDesc('sequence')->value('metadata');
            $decoded = is_string($metadata) ? json_decode($metadata, true, flags: JSON_THROW_ON_ERROR) : null;
            $accountId = is_array($decoded) ? ($decoded['collection_account_id'] ?? null) : null;
        }
        if (! is_string($accountId) || ! Str::isUuid($accountId)) {
            throw new \LogicException('Instrument carrying account was not recorded.');
        }

        return new PostingLine(accountId: $accountId, debit: $debit ? $instrument->local_amount : '0', credit: $debit ? '0' : $instrument->local_amount,
            partyId: $instrument->party_id, currency: $instrument->currency_code, fxAmount: $instrument->amount, fxRate: $instrument->fx_rate);
    }

    private function line(string $event, string $amount, bool $debit, ?string $party = null, ?string $currency = null, ?string $fxAmount = null, ?string $fxRate = null): PostingLine
    {
        $account = $this->determiner->resolve($event);

        return new PostingLine(accountId: $account->id, debit: $debit ? $amount : '0', credit: $debit ? '0' : $amount,
            partyId: $party, currency: $currency, fxAmount: $fxAmount, fxRate: $fxRate);
    }

    /** @param list<PostingLine> $lines */
    private function journal(Instrument $instrument, string $date, string $purpose, array $lines): PostedEntry
    {
        $difference = BigDecimal::of('0');
        foreach ($lines as $line) {
            $difference = $difference->plus($line->debit)->minus($line->credit);
        }
        if (! $difference->isZero()) {
            $lines[] = $this->line($difference->isPositive() ? 'fx.gain' : 'fx.loss', (string) $difference->abs(), $difference->isNegative());
        }

        return $this->posting->post(new PostingRequest(Extension::company(), new DateTimeImmutable($date), EntryType::General,
            $instrument->number, 'treasury_instrument', $instrument->id, $lines, $purpose, request()->user()?->getAuthIdentifier()));
    }

    private function local(BigDecimal $amount): string
    {
        return Treasury::local($amount);
    }

    private function lock(string $id, int $version): Instrument
    {
        $instrument = Instrument::query()->whereKey($id)->lockForUpdate()->firstOrFail();
        $instrument->assertVersion($version);

        return $instrument;
    }
}
