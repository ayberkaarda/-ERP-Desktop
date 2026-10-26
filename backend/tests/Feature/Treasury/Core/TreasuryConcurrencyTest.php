<?php

declare(strict_types=1);
use App\Core\Company\CompanyContext;
use App\Modules\Treasury\Models\TreasuryPayment;
use App\Modules\Treasury\Services\PaymentService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Tests\Feature\Treasury\Core\TreasuryKit as T;
use Tests\Support\Purchasing\PurchKit as P;

beforeEach(function (): void {
    if (! Schema::hasTable('treasury_accounts')) {
        Artisan::call('migrate', ['--force' => true]);
    }
    $this->w = T::world();
    config(['database.connections.treasury_second' => config('database.connections.pgsql')]);
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('treasury_second');
});
afterEach(function (): void {
    DB::setDefaultConnection('pgsql');
    foreach ([$this->a, $this->b] as $connection) {
        while ($connection->transactionLevel() > 0) {
            $connection->rollBack();
        }
    }
    $this->a->statement('SET session_replication_role = replica');
    try {
        foreach ($this->a->select("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id'") as $table) {
            $this->a->table($table->table_name)->where('company_id', $this->w->company)->delete();
        }$this->a->table('companies')->where('id', $this->w->company)->delete();
        $this->a->table('users')->where('id', $this->w->user->id)->delete();
    } finally {
        $this->a->statement('SET session_replication_role = DEFAULT');
    }
    DB::purge('treasury_second');
    app(CompanyContext::class)->clear();
    Carbon::setTestNow();
});
function treasurySecond(Closure $operation): mixed
{
    DB::setDefaultConnection('treasury_second');
    DB::connection('treasury_second')->statement("SET lock_timeout = '250ms'");
    try {
        return $operation();
    } finally {
        DB::setDefaultConnection('pgsql');
    }
}
it('serializes withdrawals on one account and prevents overspending after the first commit', function (): void {
    $w = $this->w;
    T::opening($w, $w->cash, '100');
    $first = T::payment($w, 'payment', '80');
    $second = T::payment($w, 'payment', '30');
    P::in($w->company, function () use ($w, $first, $second): void {
        $this->a->beginTransaction();
        app(PaymentService::class)->post($first['id'], $first['version'], $w->user->id);
        try {
            treasurySecond(fn () => app(PaymentService::class)->post($second['id'], $second['version'], $w->user->id));
            throw new RuntimeException('Expected an account lock timeout.');
        } catch (QueryException $e) {
            expect($e->errorInfo[0])->toBe('55P03');
        }
        $this->a->commit();
        expect(fn () => treasurySecond(fn () => app(PaymentService::class)->post($second['id'], $second['version'], $w->user->id)))->toThrow(ValidationException::class);
        expect(TreasuryPayment::query()->findOrFail($second['id'])->getAttribute('status'))->toBe('draft');
    });
    P::get($w->user, $w->company, 'treasury-accounts/'.$w->cash['id'].'/balance')->assertJsonPath('data.balance', '20.0000');
});
it('serializes invoice allocation even when the competing payments use different accounts', function (): void {
    $w = $this->w;
    T::opening($w, $w->cash);
    T::opening($w, $w->bank);
    $invoice = T::invoice($w);
    $allocation = [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '80', 'fx_rate' => '1']];
    $first = T::payment($w, 'payment', '80', ['allocations' => $allocation]);
    $second = T::payment($w, 'payment', '80', ['account_id' => $w->bank['id'], 'allocations' => $allocation]);
    P::in($w->company, function () use ($w, $first, $second): void {
        $this->a->beginTransaction();
        app(PaymentService::class)->post($first['id'], $first['version'], $w->user->id);
        try {
            treasurySecond(fn () => app(PaymentService::class)->post($second['id'], $second['version'], $w->user->id));
            throw new RuntimeException('Expected an invoice lock timeout.');
        } catch (QueryException $e) {
            expect($e->errorInfo[0])->toBe('55P03');
        }
        $this->a->commit();
        expect(fn () => treasurySecond(fn () => app(PaymentService::class)->post($second['id'], $second['version'], $w->user->id)))->toThrow(ValidationException::class);
    });
    P::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.paid_amount', '80.0000')->assertJsonPath('data.balance_due', '40.0000');
});
