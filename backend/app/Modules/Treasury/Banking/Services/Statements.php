<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Services;

use App\Modules\Treasury\Banking\Data\StatementData;
use App\Modules\Treasury\Banking\Enums\StatementStatus;
use App\Modules\Treasury\Banking\Models\BankStatement;
use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Contracts\TreasuryAccountLookup;
use App\Modules\Treasury\Contracts\TreasuryMovementLookup;
use App\Modules\Treasury\Data\TreasuryMovementData;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Statements
{
    public function __construct(private readonly StatementParser $parser, private readonly TreasuryAccountLookup $accounts, private readonly TreasuryMovementLookup $movements) {}

    /** @param array<string, mixed> $input */
    public function preview(array $input): StatementData
    {
        $account = $this->accounts->find((string) $input['account_id']);
        if ($account === null || ! $account->isActive || $account->type !== 'bank') {
            Extension::fail('account_id', 'invalid_account');
        }
        $parsed = $this->parser->parse((string) $input['format'], (string) $input['content'], $input);
        if ($parsed->currency !== $account->currencyCode) {
            Extension::fail('currency_code', 'invalid_currency');
        }
        if ($parsed->accountReference !== '') {
            $reference = preg_replace('/\s/', '', strtoupper($parsed->accountReference));
            $expected = $account->iban ?? null;
            if ($expected === null || ! in_array($reference, [strtoupper($expected), '/'.strtoupper($expected)], true) && ! str_ends_with((string) $reference, '/'.strtoupper($expected))) {
                Extension::fail('account_id', 'account_reference_mismatch');
            }
        }

        return $parsed;
    }

    /** @param array<string, mixed> $input */
    public function import(array $input): BankStatement
    {
        $data = $this->preview($input);

        return DB::transaction(function () use ($input, $data): BankStatement {
            $digest = hash('sha256', json_encode($data->toArray(), JSON_THROW_ON_ERROR));
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['treasury.statement.'.Extension::company().'.'.$input['account_id']]);
            if (BankStatement::query()->where('account_id', $input['account_id'])->where('content_digest', $digest)->exists()) {
                Extension::fail('content', 'duplicate_statement');
            }
            if ($data->reference !== '' && BankStatement::query()->where('account_id', $input['account_id'])->where('bank_reference', $data->reference)
                ->where('start_date', $data->from)->where('end_date', $data->to)->exists()) {
                Extension::fail('bank_reference', 'duplicate_statement');
            }
            $statement = new BankStatement([
                'account_id' => $input['account_id'], 'format' => $input['format'], 'bank_reference' => $data->reference,
                'account_reference' => $data->accountReference, 'currency_code' => $data->currency,
                'start_date' => $data->from, 'end_date' => $data->to, 'opening_balance' => $data->opening,
                'closing_balance' => $data->closing, 'content_digest' => $digest, 'status' => StatementStatus::Imported->value, 'created_by' => request()->user()?->getAuthIdentifier(),
            ]);
            $statement->save();
            foreach ($data->lines as $index => $line) {
                DB::table('treasury_bank_statement_lines')->insert([
                    'id' => (string) Str::uuid7(), 'company_id' => Extension::company(), 'statement_id' => $statement->id,
                    'line_no' => $index + 1, ...$line->toArray(),
                ]);
            }

            return $statement;
        });
    }

    /** @return array<string, mixed> */
    public function detail(BankStatement $statement): array
    {
        $lines = DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('statement_id', $statement->id)->orderBy('line_no')->get();

        return [...$statement->toArray(), 'lines' => $lines->map(static fn (object $line): array => [...(array) $line, 'matched' => $line->movement_id !== null])->all()];
    }

    public function match(string $id, int $version, string $lineId, ?string $paymentId, ?string $movementId = null): BankStatement
    {
        return DB::transaction(function () use ($id, $version, $lineId, $paymentId, $movementId): BankStatement {
            $statement = $this->lock($id, $version);
            $this->imported($statement);
            $line = DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('statement_id', $id)->where('id', $lineId)->lockForUpdate()->first();
            if ($line === null) {
                abort(404);
            }
            if ($paymentId !== null) {
                $movementId = $this->movements->forPayment($paymentId)?->id;
                if ($movementId === null) {
                    Extension::fail('payment_id', 'payment_mismatch');
                }
            }
            if ($movementId !== null) {
                $movement = $this->movements->findForUpdate($movementId);
                if ($movement === null || ! $this->compatibleMovement($statement, (string) $line->amount, $movement)) {
                    Extension::fail('movement_id', 'payment_mismatch');
                }
                $paymentId = $movement->sourceType === 'treasury_payment' ? $movement->sourceId : null;
                if (DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('movement_id', $movementId)->where('id', '<>', $lineId)->exists()) {
                    Extension::fail('movement_id', 'payment_matched');
                }
            }
            DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('id', $lineId)->update(['payment_id' => $paymentId, 'movement_id' => $movementId]);
            $statement->bumpVersion()->save();

            return $statement;
        });
    }

    public function reconcile(string $id, int $version): BankStatement
    {
        return DB::transaction(function () use ($id, $version): BankStatement {
            $statement = $this->lock($id, $version);
            $this->imported($statement);
            $lines = DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('statement_id', $id)->orderBy('line_no')->lockForUpdate()->get();
            $total = BigDecimal::of((string) $statement->getAttribute('opening_balance'));
            foreach ($lines as $line) {
                if ($line->movement_id === null || ($movement = $this->movements->findForUpdate((string) $line->movement_id)) === null || ! $this->compatibleMovement($statement, (string) $line->amount, $movement)) {
                    Extension::fail('lines', 'unmatched_lines');
                }
                $total = $total->plus((string) $line->amount);
            }
            if (! $total->isEqualTo((string) $statement->getAttribute('closing_balance'))) {
                Extension::fail('closing_balance', 'balance_mismatch');
            }
            $statement->status = StatementStatus::Reconciled->value;
            $statement->save();

            return $statement;
        });
    }

    public function reopen(string $id, int $version, string $reason): BankStatement
    {
        return DB::transaction(function () use ($id, $version, $reason): BankStatement {
            $statement = $this->lock($id, $version);
            if ($statement->status !== StatementStatus::Reconciled->value || trim($reason) === '') {
                Extension::fail('status', 'invalid_transition');
            }
            $statement->status = StatementStatus::Imported->value;
            $statement->save();
            activity()->performedOn($statement)->withProperties(['reason' => $reason])->log('reopened');

            return $statement;
        });
    }

    /** @return array{data: list<array<string, mixed>>, pagination: array<string, int>} */
    public function suggestions(BankStatement $statement, string $lineId, int $page = 1, int $perPage = 25, ?string $q = null): array
    {
        $company = Extension::company();
        $line = DB::table('treasury_bank_statement_lines')->where('company_id', $company)->where('statement_id', $statement->id)->where('id', $lineId)->first();
        abort_if($line === null, 404);
        $query = DB::table('treasury_movements as m')->where('m.company_id', $company)->where('m.account_id', $statement->account_id)
            ->where('m.currency_code', $statement->getAttribute('currency_code'))->where('m.amount', $line->amount)
            ->whereNull('m.reverses_id')
            ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('treasury_movements as r')->where('r.company_id', $company)->whereColumn('r.reverses_id', 'm.id'))
            ->whereNotExists(fn ($query) => $query->selectRaw('1')->from('treasury_bank_statement_lines as l')->where('l.company_id', $company)->whereColumn('l.movement_id', 'm.id'));
        if ($q !== null && $q !== '') {
            $query->whereRaw('CAST(m.source_id AS text) ILIKE ?', ['%'.str_replace(['%', '_'], ['\\%', '\\_'], $q).'%']);
        }
        $result = $query->orderByRaw('ABS(m.document_date - CAST(? AS date))', [$line->date])->orderByDesc('m.id')->paginate($perPage, ['m.*'], 'page', $page);
        $data = $result->getCollection()->map(static fn (\stdClass $movement): array => [
            'id' => $movement->id, 'movement_id' => $movement->id, 'payment_id' => $movement->source_type === 'treasury_payment' ? $movement->source_id : null,
            'account_id' => $movement->account_id, 'direction' => BigDecimal::of($movement->amount)->isNegative() ? 'payment' : 'receipt',
            'amount' => Extension::money((string) BigDecimal::of($movement->amount)->abs()), 'currency_code' => $movement->currency_code,
            'document_date' => $movement->document_date, 'reference' => $movement->source_id, 'source_type' => $movement->source_type,
        ])->values()->all();

        return ['data' => array_values($data), 'pagination' => ['current_page' => $result->currentPage(), 'per_page' => $result->perPage(), 'total' => $result->total(), 'last_page' => $result->lastPage()]];
    }

    private function lock(string $id, int $version): BankStatement
    {
        $statement = BankStatement::query()->whereKey($id)->lockForUpdate()->firstOrFail();
        $statement->assertVersion($version);

        return $statement;
    }

    private function imported(BankStatement $statement): void
    {
        if ($statement->status !== StatementStatus::Imported->value) {
            Extension::fail('status', 'invalid_transition');
        }
    }

    private function compatibleMovement(BankStatement $statement, string $amount, TreasuryMovementData $movement): bool
    {
        return $movement->companyId === Extension::company() && $movement->accountId === $statement->account_id
            && $movement->currencyCode === $statement->getAttribute('currency_code') && $movement->reversesId === null
            && BigDecimal::of($movement->amount)->isEqualTo($amount);
    }
}
