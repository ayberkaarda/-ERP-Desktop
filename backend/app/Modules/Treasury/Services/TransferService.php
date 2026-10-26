<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Core\Numbering\NumberSequenceService;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Treasury\Enums\DocumentStatus;
use App\Modules\Treasury\Models\TreasuryTransfer;
use App\Modules\Treasury\Support\Treasury;
use App\Modules\Treasury\Support\TreasurySettings;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

final class TransferService
{
    /** @param array<string,mixed> $input */
    public function save(?TreasuryTransfer $transfer, array $input, ?int $version, ?string $actor): TreasuryTransfer
    {
        return DB::transaction(function () use ($transfer, $input, $version, $actor): TreasuryTransfer {
            if ($transfer !== null) {
                $transfer = $this->lock($transfer->id);
                $transfer->assertVersion($version ?? 0);
                $this->draft($transfer);
            } else {
                $transfer = new TreasuryTransfer;
            }
            $data = [...$transfer->getAttributes(), ...$input];
            if ($data['from_account_id'] === $data['to_account_id']) {
                Treasury::fail('to_account_id', 'same_account');
            }
            $from = app(AccountService::class)->account((string) $data['from_account_id']);
            $to = app(AccountService::class)->account((string) $data['to_account_id']);
            if (! $from->getAttribute('is_active') || ! $to->getAttribute('is_active')) {
                Treasury::fail('account_id', 'inactive');
            }
            $data['source_fx_rate'] = app(TreasurySettings::class)->rate((string) $from->getAttribute('currency_code'), (string) $data['document_date'], isset($data['source_fx_rate']) ? (string) $data['source_fx_rate'] : null);
            $data['target_fx_rate'] = app(TreasurySettings::class)->rate((string) $to->getAttribute('currency_code'), (string) $data['document_date'], isset($data['target_fx_rate']) ? (string) $data['target_fx_rate'] : null);
            $data['fee_amount'] ??= '0';
            if ($from->getAttribute('currency_code') === $to->getAttribute('currency_code') && (! Treasury::decimal((string) $data['amount'])->isEqualTo((string) $data['target_amount']) || ! Treasury::decimal($data['source_fx_rate'])->isEqualTo($data['target_fx_rate']))) {
                Treasury::fail('target_amount', 'rate_mismatch');
            }
            if (Treasury::decimal((string) $data['fee_amount'])->isPositive()) {
                $fee = app(AccountLookup::class)->find((string) ($data['expense_account_id'] ?? ''));
                if ($fee === null || ! $fee->isActive || ! $fee->isPostable || ! in_array($fee->type, [AccountType::Expense->value, AccountType::Cost->value], true) || $fee->requiresParty || $fee->requiresProject || $fee->requiresCostCenter) {
                    Treasury::fail('expense_account_id', 'account_invalid');
                }
            }
            unset($data['version'],$data['id'],$data['company_id'],$data['created_at'],$data['updated_at']);
            $transfer->fill($data);
            if (! $transfer->exists) {
                $transfer->setAttribute('status', DocumentStatus::Draft->value);
                $transfer->setAttribute('created_by', $actor);
            }
            $transfer->save();

            return $transfer;
        });
    }

    public function post(string $id, int $version, ?string $actor): TreasuryTransfer
    {
        return DB::transaction(function () use ($id, $version, $actor): TreasuryTransfer {
            $t = $this->lock($id);
            $t->assertVersion($version);
            $this->draft($t);
            $ids = [(string) $t->getAttribute('from_account_id'), (string) $t->getAttribute('to_account_id')];
            sort($ids);
            foreach ($ids as $accountId) {
                app(AccountService::class)->account($accountId, true);
            }
            $from = app(AccountService::class)->account((string) $t->getAttribute('from_account_id'));
            $to = app(AccountService::class)->account((string) $t->getAttribute('to_account_id'));
            $amount = Treasury::decimal((string) $t->getAttribute('amount'));
            $fee = Treasury::decimal((string) $t->getAttribute('fee_amount'));
            $fromLocal = Treasury::local($amount->multipliedBy((string) $t->getAttribute('source_fx_rate')));
            $feeLocal = Treasury::local($fee->multipliedBy((string) $t->getAttribute('source_fx_rate')));
            $totalFrom = Treasury::decimal($fromLocal)->plus($feeLocal);
            $toLocal = Treasury::local(Treasury::decimal((string) $t->getAttribute('target_amount'))->multipliedBy((string) $t->getAttribute('target_fx_rate')));
            if (! Treasury::decimal($fromLocal)->isPositive() || ! Treasury::decimal($toLocal)->isPositive()) {
                Treasury::fail('amount', 'positive');
            }
            $lines = [PostingLine::credit((string) $from->getAttribute('gl_account_id'), Treasury::money($totalFrom), ['currency' => (string) $from->getAttribute('currency_code'), 'fxAmount' => Treasury::money($amount->plus($fee)), 'fxRate' => (string) $t->getAttribute('source_fx_rate')]), PostingLine::debit((string) $to->getAttribute('gl_account_id'), $toLocal, ['currency' => (string) $to->getAttribute('currency_code'), 'fxAmount' => (string) $t->getAttribute('target_amount'), 'fxRate' => (string) $t->getAttribute('target_fx_rate')])];
            if ($fee->isPositive()) {
                $lines[] = PostingLine::debit((string) $t->getAttribute('expense_account_id'), $feeLocal);
            }
            $difference = Treasury::decimal($toLocal)->minus($fromLocal);
            if (! $difference->isZero()) {
                $ref = app(AccountDeterminer::class)->resolve($difference->isPositive() ? 'fx.gain' : 'fx.loss');
                $lines[] = $difference->isPositive() ? PostingLine::credit($ref->id, Treasury::money($difference)) : PostingLine::debit($ref->id, Treasury::money($difference->abs()));
            }
            $j = app(PostingService::class)->post(new PostingRequest($t->company_id, new DateTimeImmutable((string) $t->getAttribute('document_date')), EntryType::General, $t->getAttribute('description'), 'treasury_transfer', $t->id, $lines, postedBy: $actor));
            app(AccountService::class)->record($from->id, 'treasury_transfer', $t->id, (string) $t->getAttribute('document_date'), Treasury::money($amount->plus($fee)->negated()), Treasury::money($totalFrom->negated()), $j->id);
            app(AccountService::class)->record($to->id, 'treasury_transfer', $t->id, (string) $t->getAttribute('document_date'), (string) $t->getAttribute('target_amount'), $toLocal, $j->id);
            $t->fill(['status' => DocumentStatus::Posted->value, 'journal_entry_id' => $j->id, 'number' => app(NumberSequenceService::class)->next($t->company_id, 'treasury_transfer', 'TR', (int) substr((string) $t->getAttribute('document_date'), 0, 4))]);
            $t->save();

            return $t;
        });
    }

    public function reverse(string $id, int $version, string $date, string $reason): TreasuryTransfer
    {
        return DB::transaction(function () use ($id, $version, $date, $reason): TreasuryTransfer {
            $t = $this->lock($id);
            $t->assertVersion($version);
            if ($t->getAttribute('status') !== DocumentStatus::Posted->value) {
                Treasury::fail('status', 'transition');
            }
            if ($date < (string) $t->getAttribute('document_date')) {
                Treasury::fail('date', 'date_invalid');
            }
            $ids = [(string) $t->getAttribute('from_account_id'), (string) $t->getAttribute('to_account_id')];
            sort($ids);
            foreach ($ids as $accountId) {
                app(AccountService::class)->account($accountId, true);
            }
            $j = app(PostingService::class)->reverse((string) $t->getAttribute('journal_entry_id'), new DateTimeImmutable($date), $reason);
            foreach (DB::table('treasury_movements')->where('company_id', $t->company_id)->where('source_type', 'treasury_transfer')->where('source_id', $t->id)->orderBy('account_id')->get() as $m) {
                app(AccountService::class)->record((string) $m->account_id, 'treasury_transfer_reversal', $t->id, $date, Treasury::money(Treasury::decimal((string) $m->amount)->negated()), Treasury::money(Treasury::decimal((string) $m->local_amount)->negated()), $j->id, (string) $m->id);
            }
            $t->fill(['status' => DocumentStatus::Reversed->value, 'reversal_journal_entry_id' => $j->id, 'reversal_date' => $date, 'reversal_reason' => $reason]);
            $t->save();

            return $t;
        });
    }

    public function cancel(string $id, int $version): TreasuryTransfer
    {
        return DB::transaction(function () use ($id, $version): TreasuryTransfer {
            $t = $this->lock($id);
            $t->assertVersion($version);
            $this->draft($t);
            $t->setAttribute('status', DocumentStatus::Cancelled->value);
            $t->save();

            return $t;
        });
    }

    public function delete(string $id, int $version): void
    {
        DB::transaction(function () use ($id, $version): void {
            $t = $this->lock($id);
            $t->assertVersion($version);
            $this->draft($t);
            $t->delete();
        });
    }

    private function draft(TreasuryTransfer $t): void
    {
        if ($t->getAttribute('status') !== DocumentStatus::Draft->value) {
            Treasury::fail('status', 'transition');
        }
    }

    private function lock(string $id): TreasuryTransfer
    {
        return TreasuryTransfer::query()->whereKey($id)->lockForUpdate()->firstOrFail();
    }
}
