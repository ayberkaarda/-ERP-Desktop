<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Treasury\Banking\ExtensionKit;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = ExtensionKit::world();
});

it('imports previews matches and reconciles canonical movements and guards reversal until unmatched', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $payment = ExtensionKit::receipt($w, $bank);
    $statement = ExtensionKit::statement($w, $bank);
    $line = $statement['lines'][0];
    $matched = PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/match", [
        'version' => $statement['version'], 'line_id' => $line['id'], 'payment_id' => $payment['id'],
    ])->assertOk()->assertJsonPath('data.lines.0.matched', true)->json('data');
    expect($matched['lines'][0]['movement_id'])->not->toBeNull();
    $reconciled = PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/reconcile", ['version' => $matched['version']])->assertOk()->assertJsonPath('data.status', 'reconciled')->json('data');
    PurchKit::post($w->user, $w->company, "treasury-payments/{$payment['id']}/reverse", ['version' => $payment['version'], 'date' => '2027-06-16', 'reason' => 'Returned'])->assertUnprocessable();
    $opened = PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/reopen", ['version' => $reconciled['version'], 'reason' => 'Correct match'])->assertOk()->json('data');
    PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/unmatch", ['version' => $opened['version'], 'line_id' => $line['id']])->assertOk();
    PurchKit::post($w->user, $w->company, "treasury-payments/{$payment['id']}/reverse", ['version' => $payment['version'], 'date' => '2027-06-16', 'reason' => 'Returned'])->assertOk();
});

it('prevents duplicate import alias double matches amount mismatches and stale writes', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $payment = ExtensionKit::receipt($w, $bank);
    $statement = ExtensionKit::statement($w, $bank);
    PurchKit::post($w->user, $w->company, 'treasury-bank-statements', [
        'account_id' => $bank['id'], 'format' => 'csv', 'content' => "date,amount,reference\n2027-06-15,100,BANK-1",
        'currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '100',
    ])->assertUnprocessable();
    $matched = PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/match", ['version' => 1, 'line_id' => $statement['lines'][0]['id'], 'payment_id' => $payment['id']])->assertOk()->json('data');
    PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$statement['id']}/unmatch", ['version' => 1, 'line_id' => $statement['lines'][0]['id']])->assertConflict();
    $other = PurchKit::post($w->user, $w->company, 'treasury-bank-statements', ['account_id' => $bank['id'], 'format' => 'csv',
        'content' => "date,amount,reference\n2027-06-15,100,BANK-2", 'currency_code' => 'TRY', 'opening_balance' => '100', 'closing_balance' => '200'])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "treasury-bank-statements/{$other['id']}/match", ['version' => 1, 'line_id' => $other['lines'][0]['id'], 'movement_id' => $matched['lines'][0]['movement_id']])->assertUnprocessable();
    expect(fn () => DB::transaction(fn () => DB::table('treasury_bank_statement_lines')->where('id', $statement['lines'][0]['id'])->update(['amount' => '101'])))->toThrow(QueryException::class);
});

it('checks permission before validation and hides another company statement', function (): void {
    $w = $this->w;
    $user = Actors::user([], $w->company);
    PurchKit::post($user, $w->company, 'treasury-bank-statements', [])->assertForbidden();
    $bank = ExtensionKit::bank($w);
    $statement = ExtensionKit::statement($w, $bank);
    $other = Actors::companyFor($w->user, ['treasury.banking.view']);
    PurchKit::get($w->user, $other, 'treasury-bank-statements/'.$statement['id'])->assertNotFound();
});
it('filters all canonical movements before paginating suggestions and supports list search', function (): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $payment = ExtensionKit::receipt($w, $bank);
    $original = (array) DB::table('treasury_movements')->where('source_id', $payment['id'])->first();
    $rows = [];
    for ($i = 0; $i < 105; $i++) {
        $rows[] = [...$original, 'id' => 'ffffffff-ffff-7fff-8fff-'.str_pad((string) $i, 12, '0', STR_PAD_LEFT), 'source_id' => (string) Str::uuid(), 'amount' => '1', 'local_amount' => '1'];
    }
    DB::table('treasury_movements')->insert($rows);
    $statement = PurchKit::post($w->user, $w->company, 'treasury-bank-statements', [
        'account_id' => $bank['id'], 'format' => 'csv', 'content' => "date,amount,reference\n2027-06-16,100,BANK-LATER",
        'currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '100',
    ])->assertCreated()->json('data');
    $uri = "treasury-bank-statements/{$statement['id']}/suggestions?line_id={$statement['lines'][0]['id']}";
    PurchKit::get($w->user, $w->company, $uri.'&per_page=1')->assertOk()->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.payment_id', $payment['id']);
    PurchKit::get($w->user, $w->company, $uri.'&q=unfindable')->assertOk()->assertJsonCount(0, 'data');
    PurchKit::get($w->user, $w->company, $uri.'&page=2&per_page=1')->assertOk()->assertJsonCount(0, 'data');
    PurchKit::get($w->user, $w->company, 'treasury-bank-statements?q=unfindable&status=imported')->assertOk()->assertJsonCount(0, 'data');
    PurchKit::get($w->user, $w->company, 'treasury-bank-statements?status=reconciled')->assertOk()->assertJsonCount(0, 'data');
});
it('previews default csv and mt940 with empty optional bank reference through middleware', function (string $format, ?string $reference): void {
    $w = $this->w;
    $bank = ExtensionKit::bank($w);
    $input = ['account_id' => $bank['id'], 'format' => $format, 'bank_reference' => $reference];
    if ($format === 'csv') {
        $input += ['content' => "date,amount,reference\n2027-06-15,100,BANK-1", 'currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '100', 'delimiter' => 'comma', 'decimal_separator' => '.'];
    } else {
        $input['content'] = ":20:MT940\n:25:TR330006100519786457841326\n:28C:1\n:60F:C270615TRY0,00\n:61:270615C100,00NTRFREF\n:62F:C270615TRY100,00";
    }
    PurchKit::post($w->user, $w->company, 'treasury-bank-statements/preview', $input)->assertOk()->assertJsonPath('data.closing_balance', '100.0000')->assertJsonCount(1, 'data.lines');
    expect(DB::table('treasury_bank_statements')->where('company_id', $w->company)->count())->toBe(0);
})->with([['csv', ''], ['csv', null], ['mt940', ''], ['mt940', null]]);
