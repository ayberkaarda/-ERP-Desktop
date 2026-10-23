<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Treasury\Banking\ExtensionKit;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = ExtensionKit::world();
});

function treasuryInstrument(object $w, string $kind = 'cheque', string $direction = 'received', ?array $invoice = null, string $currency = 'TRY', string $fxRate = '1'): array
{
    return PurchKit::post($w->user, $w->company, 'treasury-instruments', [
        'kind' => $kind, 'direction' => $direction, 'instrument_number' => 'INSTRUMENT-'.random_int(1, 999999),
        'party_id' => $direction === 'received' ? $w->customer->id : $w->party->id,
        'amount' => $invoice['total'] ?? '100', 'currency_code' => $currency, 'fx_rate' => $fxRate,
        'issue_date' => '2027-06-10', 'due_date' => '2027-06-30', 'allocations' => $invoice === null ? [] : [
            ['invoice_module' => $direction === 'received' ? 'sales' : 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => $invoice['total']],
        ],
    ])->assertCreated()->json('data');
}

function treasuryInstrumentAction(object $w, array $instrument, string $action, array $input = []): array
{
    return PurchKit::post($w->user, $w->company, 'treasury-instruments/'.$instrument['id'].'/'.$action,
        ['version' => $instrument['version'], 'document_date' => '2027-06-15', ...$input])->assertOk()->json('data');
}

it('settles a sales invoice into cheque portfolio then collection bank and fully unwinds dishonour', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'sales');
    $bank = ExtensionKit::bank($w);
    $instrument = treasuryInstrument($w, 'cheque', 'received', $invoice);
    $instrument = treasuryInstrumentAction($w, $instrument, 'receive');
    expect($instrument['status'])->toBe('portfolio')->and(Books::balance($w->company, '101'))->toBe('120.0000');
    PurchKit::get($w->user, $w->company, 'sales-invoices/'.$invoice['id'])->assertJsonPath('data.status', 'paid');
    $instrument = treasuryInstrumentAction($w, $instrument, 'collect');
    expect(Books::balance($w->company, '101'))->toBe('0.0000')->and(Books::balance($w->company, '108'))->toBe('120.0000');
    $instrument = treasuryInstrumentAction($w, $instrument, 'clear', ['account_id' => $bank['id']]);
    expect(Books::balance($w->company, '108'))->toBe('0.0000')->and(Books::balance($w->company, '102'))->toBe('120.0000');
    $instrument = treasuryInstrumentAction($w, $instrument, 'dishonour', ['reason' => 'Returned by bank']);
    expect($instrument['status'])->toBe('dishonoured')->and(Books::balance($w->company, '101'))->toBe('0.0000')
        ->and(Books::balance($w->company, '108'))->toBe('0.0000')->and(Books::balance($w->company, '102'))->toBe('0.0000');
    PurchKit::get($w->user, $w->company, 'sales-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '120.0000')->assertJsonPath('data.status', 'issued');
    expect(DB::table('treasury_instrument_events')->where('instrument_id', $instrument['id'])->count())->toBe(4);
});

it('issues and clears a supplier note and reopens its invoice on return', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'purchasing');
    $bank = ExtensionKit::bank($w);
    ExtensionKit::receipt($w, $bank, '200');
    $instrument = treasuryInstrument($w, 'note', 'issued', $invoice);
    $instrument = treasuryInstrumentAction($w, $instrument, 'issue');
    expect(Books::balance($w->company, '321'))->toBe('-120.0000');
    PurchKit::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.status', 'paid');
    $instrument = treasuryInstrumentAction($w, $instrument, 'clear', ['account_id' => $bank['id']]);
    expect(Books::balance($w->company, '321'))->toBe('0.0000')->and(Books::balance($w->company, '102'))->toBe('80.0000');
    $instrument = treasuryInstrumentAction($w, $instrument, 'return', ['reason' => 'Instrument returned']);
    expect(Books::balance($w->company, '102'))->toBe('200.0000');
    PurchKit::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '120.0000');
});

it('pledges releases endorses and unwinds supplier settlement without creating cash', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'purchasing');
    $instrument = treasuryInstrument($w);
    $instrument = treasuryInstrumentAction($w, $instrument, 'receive');
    $count = DB::table('journal_entries')->count();
    $instrument = treasuryInstrumentAction($w, $instrument, 'pledge', ['reason' => 'Collateral']);
    $instrument = treasuryInstrumentAction($w, $instrument, 'release');
    expect(DB::table('journal_entries')->count())->toBe($count)->and(DB::table('treasury_movements')->count())->toBe(0);
    $instrument = treasuryInstrumentAction($w, $instrument, 'endorse', ['party_id' => $w->party->id,
        'allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '100']]]);
    expect($instrument['status'])->toBe('endorsed')->and(Books::balance($w->company, '101'))->toBe('0.0000');
    PurchKit::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '20.0000');
    treasuryInstrumentAction($w, $instrument, 'return', ['reason' => 'Endorsement unwound']);
    PurchKit::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '120.0000');
});

it('rejects illegal lifecycle stale versions and raw changes to a posted instrument or history', function (): void {
    $w = $this->w;
    $instrument = treasuryInstrument($w);
    PurchKit::post($w->user, $w->company, 'treasury-instruments/'.$instrument['id'].'/clear', ['version' => 1, 'document_date' => '2027-06-15', 'account_id' => '01900000-0000-7000-8000-000000000001'])->assertUnprocessable();
    $posted = treasuryInstrumentAction($w, $instrument, 'receive');
    PurchKit::post($w->user, $w->company, 'treasury-instruments/'.$instrument['id'].'/collect', ['version' => 1, 'document_date' => '2027-06-15'])->assertConflict();
    expect(fn () => DB::transaction(fn () => DB::table('treasury_instruments')->where('id', $instrument['id'])->update(['amount' => '999'])))->toThrow(QueryException::class);
    expect(fn () => DB::transaction(fn () => DB::table('treasury_instrument_events')->where('instrument_id', $instrument['id'])->delete()))->toThrow(QueryException::class);
});

it('matches an instrument clear as a canonical bank movement and blocks its reversal', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $instrument = treasuryInstrumentAction($w, treasuryInstrument($w), 'receive');
    $instrument = treasuryInstrumentAction($w, $instrument, 'clear', ['account_id' => $bank['id']]);
    $statement = ExtensionKit::statement($w, $bank);
    $movement = DB::table('treasury_movements')->where('source_type', 'treasury_instrument')->where('source_id', $instrument['id'])->first();
    PurchKit::post($w->user, $w->company, 'treasury-bank-statements/'.$statement['id'].'/match', ['version' => 1, 'line_id' => $statement['lines'][0]['id'], 'movement_id' => $movement->id])->assertOk();
    PurchKit::post($w->user, $w->company, 'treasury-instruments/'.$instrument['id'].'/dishonour', ['version' => $instrument['version'], 'document_date' => '2027-06-16', 'reason' => 'Bank return'])->assertUnprocessable();
    expect(Books::balance($w->company, '102'))->toBe('100.0000');
});

it('consumes exact remaining invoice carrying after an out-of-order partial payment reversal', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'sales', '3', 'USD', '0.333333', '0');
    $bank = ExtensionKit::bank($w, 'USD-BANK', 'USD');
    $payments = [];
    for ($i = 0; $i < 2; $i++) {
        $draft = PurchKit::post($w->user, $w->company, 'treasury-payments', ['direction' => 'receipt', 'account_id' => $bank['id'],
            'party_id' => $w->customer->id, 'document_date' => '2027-06-15', 'amount' => '1', 'currency_code' => 'USD', 'fx_rate' => '0.333333',
            'allocations' => [['invoice_module' => 'sales', 'invoice_id' => $invoice['id'], 'amount' => '1', 'fx_rate' => '0.333333']]])->assertCreated()->json('data');
        $payments[] = PurchKit::post($w->user, $w->company, 'treasury-payments/'.$draft['id'].'/post', ['version' => $draft['version']])->assertOk()->json('data');
    }
    PurchKit::post($w->user, $w->company, 'treasury-payments/'.$payments[0]['id'].'/reverse', ['version' => $payments[0]['version'], 'date' => '2027-06-15', 'reason' => 'Reverse first partial'])->assertOk();
    expect(Books::balance($w->company, '120'))->toBe('0.6600');
    $instrument = treasuryInstrument($w, 'cheque', 'received', [...$invoice, 'total' => '2'], 'USD', '0.333333');
    $instrument = treasuryInstrumentAction($w, $instrument, 'receive');
    expect($instrument['allocations'][0]['carrying_local'])->toBe('0.6600')->and(Books::balance($w->company, '120'))->toBe('0.0000');
    PurchKit::get($w->user, $w->company, 'sales-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '0.0000');
});

it('preserves required party dimensions for received and issued notes on the full production chart', function (): void {
    $w = ExtensionKit::world(true);
    expect(Books::account($w->company, '121')->requires_party)->toBeTrue()
        ->and(Books::account($w->company, '321')->requires_party)->toBeTrue();
    $bank = ExtensionKit::bank($w);
    ExtensionKit::receipt($w, $bank, '200');
    $received = treasuryInstrumentAction($w, treasuryInstrument($w, 'note'), 'receive');
    expect(Books::balance($w->company, '121'))->toBe('100.0000');
    $received = treasuryInstrumentAction($w, $received, 'collect');
    $received = treasuryInstrumentAction($w, $received, 'clear', ['account_id' => $bank['id']]);
    expect(Books::balance($w->company, '121'))->toBe('0.0000');
    $issued = treasuryInstrumentAction($w, treasuryInstrument($w, 'note', 'issued'), 'issue');
    expect(Books::balance($w->company, '321'))->toBe('-100.0000');
    $issued = treasuryInstrumentAction($w, $issued, 'clear', ['account_id' => $bank['id']]);
    expect(Books::balance($w->company, '321'))->toBe('0.0000');
    treasuryInstrumentAction($w, $received, 'return', ['reason' => 'Received note returned']);
    treasuryInstrumentAction($w, $issued, 'return', ['reason' => 'Issued note returned']);
    expect(Books::balance($w->company, '121'))->toBe('0.0000')->and(Books::balance($w->company, '321'))->toBe('0.0000')
        ->and(Books::balance($w->company, '102'))->toBe('200.0000');
});

it('clears the original portfolio and collection accounts after determination rules change', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $instrument = treasuryInstrumentAction($w, treasuryInstrument($w), 'receive');
    DB::table('account_determination_rules')->where('company_id', $w->company)->where('event_key', 'treasury.cheque_portfolio')->update(['account_id' => Books::account($w->company, '100')->id]);
    $instrument = treasuryInstrumentAction($w, $instrument, 'collect');
    expect(Books::balance($w->company, '101'))->toBe('0.0000')->and(Books::balance($w->company, '108'))->toBe('100.0000');
    DB::table('account_determination_rules')->where('company_id', $w->company)->where('event_key', 'treasury.collection')->update(['account_id' => Books::account($w->company, '100')->id]);
    treasuryInstrumentAction($w, $instrument, 'clear', ['account_id' => $bank['id']]);
    expect(Books::balance($w->company, '108'))->toBe('0.0000')->and(Books::balance($w->company, '100'))->toBe('0.0000')
        ->and(Books::balance($w->company, '102'))->toBe('100.0000');
});

it('settles the original invoice control account after receivable mapping changes', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'sales');
    DB::table('account_determination_rules')->where('company_id', $w->company)->where('event_key', 'sales.receivable')->update(['account_id' => Books::account($w->company, '320')->id]);
    treasuryInstrumentAction($w, treasuryInstrument($w, 'cheque', 'received', $invoice), 'receive');
    expect(Books::balance($w->company, '120'))->toBe('0.0000')->and(Books::balance($w->company, '320'))->toBe('0.0000');
});
it('gates persisted source identities before detail updates and actions without invoice permission', function (): void {
    $w = $this->w;
    $invoice = ExtensionKit::invoice($w, 'sales');
    $instrument = treasuryInstrument($w, 'cheque', 'received', $invoice);
    $user = Actors::user(['treasury.instruments.view', 'treasury.instruments.update', 'treasury.instruments.post'], $w->company);
    PurchKit::get($user, $w->company, 'treasury-instruments/'.$instrument['id'])->assertForbidden();
    PurchKit::patch($user, $w->company, 'treasury-instruments/'.$instrument['id'], ['version' => 1, 'reference' => 'Unauthorized change'])->assertForbidden();
    PurchKit::post($user, $w->company, 'treasury-instruments/'.$instrument['id'].'/receive', ['version' => 1, 'document_date' => '2027-06-15'])->assertForbidden();
    expect(DB::table('treasury_instruments')->where('id', $instrument['id'])->value('version'))->toBe(1);
    PurchKit::get($user, $w->company, 'treasury-instruments')->assertOk()->assertJsonMissing(['invoice_id' => $invoice['id']]);
    Actors::grant($user, $w->company, ['sales.invoices.view']);
    PurchKit::get($user, $w->company, 'treasury-instruments/'.$instrument['id'])->assertOk()->assertJsonPath('data.allocations.0.invoice_id', $invoice['id']);
});
