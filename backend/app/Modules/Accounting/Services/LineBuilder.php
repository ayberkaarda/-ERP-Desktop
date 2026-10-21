<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Models\JournalLine;
use App\Modules\Accounting\Support\LineInput;
use App\Modules\Accounting\Support\Messages;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\DimensionLookup;
use Brick\Math\BigDecimal;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Turns raw lines (API payloads or PostingLine DTOs) into validated LineInputs of the active
 * company, and checks the rules a booked entry must satisfy. Errors are keyed lines.N.field.
 */
final class LineBuilder
{
    public const string MONEY = '/^\d{1,16}(\.\d{1,4})?$/';

    public const string RATE = '/^\d{1,14}(\.\d{1,6})?$/';

    /** @var array<string, list<string>> */
    private array $errors = [];

    public function __construct(
        private readonly PartyLookup $parties,
        private readonly DimensionLookup $dimensions,
        private readonly CurrencyLookup $currencies,
    ) {}

    /**
     * @param  list<PostingLine>  $lines
     * @return list<array<string, string|null>>
     */
    public static function fromPostingLines(array $lines): array
    {
        return array_map(static fn (PostingLine $l): array => [
            'account_id' => $l->accountId,
            'account_code' => $l->accountCode,
            'debit' => $l->debit,
            'credit' => $l->credit,
            'currency_code' => $l->currency,
            'fx_amount' => $l->fxAmount,
            'fx_rate' => $l->fxRate,
            'party_id' => $l->partyId,
            'cost_center_id' => $l->costCenterId,
            'project_id' => $l->projectId,
            'description' => $l->description,
            'due_date' => $l->dueDate,
            'document_ref' => $l->documentRef,
        ], $lines);
    }

    /**
     * Lines already stored on an entry, as inputs (to post a draft or mirror a booked entry).
     *
     * @return list<LineInput>
     */
    public static function fromEntry(JournalEntry $entry): array
    {
        $lines = JournalLine::query()->with('account')->where('entry_id', $entry->id)->orderBy('line_no')->get();

        return array_values($lines->map(static fn (JournalLine $l): LineInput => new LineInput(
            $l->account, $l->debit, $l->credit, $l->currency_code, $l->fx_amount, $l->fx_rate,
            $l->party_id, $l->cost_center_id, $l->project_id, $l->description, $l->due_date?->format('Y-m-d'), $l->document_ref,
        ))->all());
    }

    /**
     * @param  list<array<string, mixed>>  $raw
     * @return list<LineInput>
     *
     * @throws ValidationException
     */
    public function build(array $raw, bool $requireActive = true): array
    {
        $this->errors = [];

        if ($raw === []) {
            Messages::fail('lines', 'lines_required');
        }

        if (count($raw) > JournalEntry::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => JournalEntry::MAX_LINES]);
        }

        $accounts = $this->accounts($raw);
        $this->checkDimensions($raw);
        $lines = [];

        foreach ($raw as $i => $line) {
            $account = $this->resolveAccount($line, $accounts, $i);
            $debit = $this->money($line['debit'] ?? '0', "lines.{$i}.debit");
            $credit = $this->money($line['credit'] ?? '0', "lines.{$i}.credit");

            if ($debit !== null && $credit !== null && $debit->isPositive() === $credit->isPositive()) {
                $this->error("lines.{$i}.debit", 'line_one_side');
            }

            $currency = self::str($line['currency_code'] ?? null);
            $fxAmount = self::str($line['fx_amount'] ?? null);
            $fxRate = self::str($line['fx_rate'] ?? null);
            $fxAmount = $fxAmount === null ? null : $this->money($fxAmount, "lines.{$i}.fx_amount");
            $fxRate = $fxRate === null ? null : $this->decimal($fxRate, "lines.{$i}.fx_rate");

            if ($currency !== null && preg_match('/^[A-Z]{3}$/', $currency) !== 1) {
                $this->error("lines.{$i}.currency_code", 'currency_missing');
            }

            if ($account !== null) {
                if (! $account->is_postable) {
                    $this->error("lines.{$i}.account_id", 'account_not_postable', ['code' => $account->code]);
                }

                if ($requireActive && ! $account->is_active) {
                    $this->error("lines.{$i}.account_id", 'account_inactive', ['code' => $account->code]);
                }

                if ($account->currency_code !== null && $currency !== null && $currency !== $account->currency_code) {
                    $this->error("lines.{$i}.currency_code", 'currency_mismatch', ['code' => $account->code, 'currency' => $account->currency_code]);
                }
            }

            if ($account === null || $debit === null || $credit === null) {
                continue;
            }

            $lines[] = new LineInput(
                $account, $debit, $credit, $currency, $fxAmount, $fxRate,
                self::str($line['party_id'] ?? null), self::str($line['cost_center_id'] ?? null), self::str($line['project_id'] ?? null),
                self::str($line['description'] ?? null), self::str($line['due_date'] ?? null), self::str($line['document_ref'] ?? null),
            );
        }

        $this->throwIfErrors();

        return $lines;
    }

    /**
     * What a booked entry needs on top of build(): balanced, non-zero, and (for documents and manual
     * entries, not for generated ones) the dimensions and currency data the accounts require.
     *
     * @param  list<LineInput>  $lines
     * @return array{0: BigDecimal, 1: BigDecimal}
     *
     * @throws ValidationException
     */
    public function assertBookable(array $lines, bool $strict): array
    {
        $this->errors = [];
        $debit = BigDecimal::zero();
        $credit = BigDecimal::zero();

        foreach ($lines as $i => $line) {
            $debit = $debit->plus($line->debit);
            $credit = $credit->plus($line->credit);

            if (! $line->account->is_postable) {
                $this->error("lines.{$i}.account_id", 'account_not_postable', ['code' => $line->account->code]);
            }

            if (! $strict) {
                continue;
            }

            foreach (['requires_party' => ['partyId', 'party_id'], 'requires_cost_center' => ['costCenterId', 'cost_center_id'], 'requires_project' => ['projectId', 'project_id']] as $flag => [$property, $field]) {
                if ($line->account->{$flag} && $line->{$property} === null) {
                    $this->error("lines.{$i}.{$field}", 'dimension_required', ['code' => $line->account->code]);
                }
            }

            if ($line->account->currency_code !== null && ($line->currency === null || $line->fxAmount === null)) {
                $this->error("lines.{$i}.fx_amount", 'fx_required', ['code' => $line->account->code, 'currency' => $line->account->currency_code]);
            }
        }

        if ($lines === [] || $debit->isZero()) {
            $this->error('lines', 'entry_empty');
        } elseif (! $debit->isEqualTo($credit)) {
            $this->error('lines', 'entry_unbalanced', ['debit' => (string) $debit, 'credit' => (string) $credit]);
        }

        $this->throwIfErrors();

        return [$debit, $credit];
    }

    /**
     * @param  list<array<string, mixed>>  $raw
     * @return array{ids: array<string, Account>, codes: array<string, Account>}
     */
    private function accounts(array $raw): array
    {
        $ids = [];
        $codes = [];

        foreach ($raw as $line) {
            $id = self::str($line['account_id'] ?? null);
            $code = self::str($line['account_code'] ?? null);

            if ($id !== null && Str::isUuid($id)) {
                $ids[$id] = true;
            } elseif ($id === null && $code !== null) {
                $codes[$code] = true;
            }
        }

        $byId = $ids === [] ? collect() : Account::query()->whereIn('id', array_keys($ids))->get()->keyBy('id');
        $byCode = $codes === [] ? collect() : Account::query()->whereIn('code', array_map('strval', array_keys($codes)))->get()->keyBy('code');

        /** @var array<string, Account> $idMap */
        $idMap = $byId->all();
        /** @var array<string, Account> $codeMap */
        $codeMap = $byCode->all();

        return ['ids' => $idMap, 'codes' => $codeMap];
    }

    /**
     * @param  array<string, mixed>  $line
     * @param  array{ids: array<string, Account>, codes: array<string, Account>}  $accounts
     */
    private function resolveAccount(array $line, array $accounts, int $i): ?Account
    {
        $id = self::str($line['account_id'] ?? null);
        $code = self::str($line['account_code'] ?? null);
        $account = $id !== null ? ($accounts['ids'][$id] ?? null) : ($code !== null ? ($accounts['codes'][$code] ?? null) : null);

        if ($account === null) {
            $this->error("lines.{$i}.account_id", 'account_missing', ['code' => $code ?? $id ?? '']);
        }

        return $account;
    }

    /**
     * Existence of parties, cost centers, projects and currencies, one lookup per distinct value.
     *
     * @param  list<array<string, mixed>>  $raw
     */
    private function checkDimensions(array $raw): void
    {
        $checks = [
            'party_id' => fn (string $id): bool => Str::isUuid($id) && $this->parties->exists($id),
            'cost_center_id' => fn (string $id): bool => Str::isUuid($id) && $this->dimensions->costCenterExists($id),
            'project_id' => fn (string $id): bool => Str::isUuid($id) && $this->dimensions->projectExists($id),
            'currency_code' => fn (string $code): bool => preg_match('/^[A-Z]{3}$/', $code) !== 1 || $this->currencies->exists($code),
        ];
        $keys = ['party_id' => 'party_missing', 'cost_center_id' => 'cost_center_missing', 'project_id' => 'project_missing', 'currency_code' => 'currency_missing'];

        foreach ($checks as $field => $exists) {
            $known = [];

            foreach ($raw as $i => $line) {
                $value = self::str($line[$field] ?? null);

                if ($value === null) {
                    continue;
                }

                $known[$value] ??= $exists($value);

                if (! $known[$value]) {
                    $this->error("lines.{$i}.{$field}", $keys[$field]);
                }
            }
        }
    }

    private function money(mixed $value, string $field): ?BigDecimal
    {
        if (is_int($value)) {
            $value = (string) $value;
        }

        if (! is_string($value) || preg_match(self::MONEY, $value) !== 1) {
            $this->error($field, 'amount_invalid');

            return null;
        }

        return BigDecimal::of($value)->toScale(4);
    }

    private function decimal(string $value, string $field): ?BigDecimal
    {
        if (preg_match(self::RATE, $value) !== 1 || BigDecimal::of($value)->isZero()) {
            $this->error($field, 'rate_invalid');

            return null;
        }

        return BigDecimal::of($value)->toScale(6);
    }

    private static function str(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * @param  array<string, string|int|float>  $replace
     */
    private function error(string $field, string $key, array $replace = []): void
    {
        $this->errors[$field][] = Messages::get($key, $replace);
    }

    /**
     * @throws ValidationException
     */
    private function throwIfErrors(): void
    {
        if ($this->errors !== []) {
            $errors = $this->errors;
            $this->errors = [];

            throw ValidationException::withMessages($errors);
        }
    }
}
