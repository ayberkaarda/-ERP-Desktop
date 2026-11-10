<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Sync;

use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\ActingAs;
use App\Core\Sync\Contracts\PrunesUnchangedFields;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\TargetConstraints;
use App\Core\Sync\WriteOutcome;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Treasury\Enums\DocumentStatus;
use App\Modules\Treasury\Http\Controllers\TreasuryCoreController;
use App\Modules\Treasury\Http\Resources\PaymentResource;
use App\Modules\Treasury\Models\TreasuryAllocation;
use App\Modules\Treasury\Models\TreasuryPayment;
use BackedEnum;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Write side of `treasury-payments`: create, update and delete of draft payments, nothing else.
 *
 * Each mutation runs the REST endpoint itself: a synthetic request matched against the module's
 * own route (so the `area` default is the REST one) handed to TreasuryCoreController's store /
 * update / destroy. That is the same permission check (`treasury-access` with
 * treasury.payments.create|update|delete in the active company), the same rules (unknown keys
 * refused, amounts, rates, client key), the same invoice permission check of the allocations
 * and the same PaymentService::save / delete, so offline and online writes cannot diverge.
 *
 * What a sync push can never do: assign the number (only posting does, PaymentService::post),
 * move money or post to the ledger (save and delete write the draft and its allocations only),
 * or touch a payment that left draft (draft_only, and PaymentService answers DOCUMENT_LOCKED).
 * Submit, post, reverse and cancel stay online (manifest online_only `treasuryPayment`).
 */
final class PaymentSyncWriter implements PrunesUnchangedFields, SyncWriter
{
    private const string PATH = '/api/v1/treasury-payments';

    public function resource(): string
    {
        return PaymentSyncResource::NAME;
    }

    public function find(string $id): ?Model
    {
        return Str::isUuid($id) ? TreasuryPayment::query()->find($id) : null;
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof TreasuryPayment ? $target->currentVersion() : 0;
    }

    public function isDraft(Model $target): bool
    {
        if (! $target instanceof TreasuryPayment) {
            return false;
        }

        $status = $target->getAttribute('status');

        return ($status instanceof BackedEnum ? $status->value : $status) === DocumentStatus::Draft->value;
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        return TargetConstraints::satisfiedBy($target, $constraints);
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        return $this->run($user, $mutation, null, function (TreasuryCoreController $rest) use ($user, $mutation): WriteOutcome {
            $rest->store($this->request($user, 'POST', self::PATH, [...$this->payload($mutation), 'id' => $mutation->id]));

            return $this->applied($mutation->id);
        });
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        $payment = $this->payment($target);

        return $this->run($user, $mutation, $payment, function (TreasuryCoreController $rest) use ($user, $mutation, $payment, $version): WriteOutcome {
            // The client never sends `version`; the version the endpoint must see comes from the resolver.
            $rest->update($this->request($user, 'PATCH', self::PATH.'/'.$payment->id, [...$this->payload($mutation), 'version' => $version]), $payment->id);

            return $this->applied($payment->id);
        });
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        $payment = $this->payment($target);

        return $this->run($user, $mutation, $payment, function (TreasuryCoreController $rest) use ($user, $payment, $version): WriteOutcome {
            $rest->destroy($this->request($user, 'DELETE', self::PATH.'/'.$payment->id, ['version' => $version]), $payment->id);

            return WriteOutcome::deleted();
        });
    }

    /** Submit, post, reverse and cancel move money or start approvals: online only. */
    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    /**
     * What only the server sets: the number and status, and what posting, approval and reversal
     * write. The REST rules refuse these keys too; offline they are refused before the endpoint.
     */
    public function lockedFields(): array
    {
        return [
            'status', 'number', 'journal_entry_id', 'reversal_journal_entry_id', 'reversal_date', 'reversal_reason',
            'approval_request_id', 'amount_local', 'allocated_local', 'advance_local', 'realized_fx', 'created_by',
        ];
    }

    /**
     * Columns of the payment's activity log (TreasuryRecord logs every attribute). Allocations are
     * not logged on the payment, so a stale update that changes them is always a conflict
     * (withoutUnchanged drops allocations resent as they are stored).
     */
    public function auditFields(): array
    {
        return [
            'number', 'document_date', 'status', 'description', 'version', 'direction', 'account_id', 'party_id',
            'currency_code', 'amount', 'fx_rate', 'reference', 'counterparty_module', 'journal_entry_id',
            'reversal_journal_entry_id', 'reversal_date', 'reversal_reason', 'approval_request_id',
            'amount_local', 'allocated_local', 'advance_local', 'realized_fx', 'created_by',
        ];
    }

    /**
     * The editor sends the allocations on every save (PaymentEditor.tsx). When they equal the
     * stored ones, line for line (invoice, amount and rate at the stored scales; order does not
     * matter), they are not an edit: dropped before the conflict decision, so a stale base merges
     * on the fields that did change and the stored allocation rows stay as they are. Any
     * difference keeps them in the mutation, and a stale base conflicts on `allocations`.
     *
     * Nothing is pruned when the sent lines are not what the REST rules accept as sent (exact
     * keys, strings in the money and rate formats, a rate given): the endpoint answers those.
     * Nothing is pruned either for a user without the invoice view of every stored line
     * (TreasuryCoreController::sources refuses the rewrite): the probe would tell whether lines
     * the user cannot read equal the sent ones.
     */
    public function withoutUnchanged(Authenticatable $user, Mutation $mutation, Model $target): Mutation
    {
        if (! $target instanceof TreasuryPayment || ! array_key_exists('allocations', $mutation->payload)) {
            return $mutation;
        }

        $sent = self::allocationLines($mutation->payload['allocations']);

        if ($sent === null) {
            return $mutation;
        }

        $company = (string) $target->getAttribute('company_id');
        $rows = TreasuryAllocation::query()
            ->where('company_id', $company)
            ->where('payment_id', $target->getKey())
            ->get()
            ->map(static fn (TreasuryAllocation $allocation): array => $allocation->getAttributes())
            ->all();

        if (! $user instanceof User || ! $this->seesAll($user, $company, $rows)) {
            return $mutation;
        }

        return $sent === self::storedLines($rows) ? $mutation->without(['allocations']) : $mutation;
    }

    /**
     * The sent lines in a comparable form, sorted, or null unless each is exactly what the REST
     * rules take (`allocations.*` of TreasuryCoreController): the four keys at most, module,
     * invoice and a money string with up to 4 decimals and a rate string with up to 6.
     *
     * @return list<string>|null
     */
    private static function allocationLines(mixed $allocations): ?array
    {
        if (! is_array($allocations) || ! array_is_list($allocations)) {
            return null;
        }

        $lines = [];

        foreach ($allocations as $line) {
            if (! is_array($line) || array_diff_key($line, ['invoice_module' => 1, 'invoice_id' => 1, 'amount' => 1, 'fx_rate' => 1]) !== []) {
                return null;
            }

            $module = $line['invoice_module'] ?? null;
            $invoice = $line['invoice_id'] ?? null;
            $amount = $line['amount'] ?? null;
            $rate = $line['fx_rate'] ?? null;

            if (! in_array($module, ['sales', 'purchasing'], true) || ! is_string($invoice) || ! Str::isUuid($invoice)
                || ! is_string($amount) || preg_match('/^\d{1,16}(\.\d{1,4})?$/', $amount) !== 1
                || ! is_string($rate) || preg_match('/^\d{1,14}(\.\d{1,6})?$/', $rate) !== 1) {
                return null;
            }

            $lines[] = self::line($module, $invoice, $amount, $rate);
        }

        sort($lines);

        return $lines;
    }

    /**
     * The stored rows in the same comparable form, sorted.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return list<string>
     */
    private static function storedLines(array $rows): array
    {
        $lines = array_map(static fn (array $row): string => self::line((string) $row['invoice_module'], (string) $row['invoice_id'], (string) $row['amount'], (string) $row['fx_rate']), $rows);
        sort($lines);

        return $lines;
    }

    private static function line(string $module, string $invoice, string $amount, string $rate): string
    {
        return implode('|', [
            $module,
            strtolower($invoice),
            (string) BigDecimal::of($amount)->toScale(4, RoundingMode::HalfUp),
            (string) BigDecimal::of($rate)->toScale(6, RoundingMode::HalfUp),
        ]);
    }

    /**
     * Whether the user may read every stored allocation, as PaymentResource and
     * TreasuryCoreController::sources judge it (sales.invoices.view / purchasing.invoices.view
     * in the payment's company).
     *
     * @param  array<int, array<string, mixed>>  $rows
     */
    private function seesAll(User $user, string $company, array $rows): bool
    {
        $authorizer = app(CompanyAuthorizer::class);

        foreach (array_unique(array_map(static fn (array $row): string => (string) $row['invoice_module'], $rows)) as $module) {
            if (! $authorizer->allows($user, $module === 'sales' ? 'sales.invoices.view' : 'purchasing.invoices.view', $company)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Runs one write as $user and turns what REST would answer with an error into an outcome.
     *
     * @param  Closure(TreasuryCoreController): WriteOutcome  $write
     */
    private function run(Authenticatable $user, Mutation $mutation, ?TreasuryPayment $target, Closure $write): WriteOutcome
    {
        try {
            return ActingAs::run($user, static fn (): WriteOutcome => $write(app(TreasuryCoreController::class)));
        } catch (ValidationException $e) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $this->fields($e->errors()));
        } catch (AuthorizationException) {
            return WriteOutcome::rejected(ErrorCode::Forbidden);
        } catch (ModelNotFoundException) {
            return WriteOutcome::rejected(ErrorCode::NotFound);
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        } catch (ApiException $e) {
            if ($e->errorCode === ErrorCode::DocumentLocked && $target !== null) {
                $current = TreasuryPayment::query()->find($target->id) ?? $target;

                return WriteOutcome::conflict(SyncConflict::documentLocked($mutation->baseVersion, $current->currentVersion(), $this->data($current)));
            }

            return WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
        }
    }

    /**
     * The REST request: matched against the module's routes, so `area` and the route
     * parameters are those of the real endpoint.
     *
     * @param  array<string, mixed>  $payload
     */
    private function request(Authenticatable $user, string $method, string $uri, array $payload): Request
    {
        $request = Request::create($uri, $method, $payload, server: ['HTTP_ACCEPT' => 'application/json']);
        $route = app('router')->getRoutes()->match($request);
        $request->setRouteResolver(static fn () => $route);
        $request->setUserResolver(static fn (): Authenticatable => $user);

        return $request;
    }

    /**
     * Payload as the endpoint takes it: the client never sends version nor, on an edit, the key.
     *
     * @return array<string, mixed>
     */
    private function payload(Mutation $mutation): array
    {
        return array_diff_key($mutation->payload, ['id' => true, 'version' => true]);
    }

    /** The stored row, read back as the pull serves it. */
    private function applied(string $id): WriteOutcome
    {
        $payment = TreasuryPayment::query()->findOrFail($id);

        return WriteOutcome::applied($payment->currentVersion(), $this->data($payment));
    }

    /**
     * @return array<string, mixed>
     */
    private function data(TreasuryPayment $payment): array
    {
        /** @var array<string, mixed> */
        return json_decode(json_encode((new PaymentResource($payment))->resolve(new Request), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), true, 512, JSON_THROW_ON_ERROR);
    }

    private function payment(Model $target): TreasuryPayment
    {
        if (! $target instanceof TreasuryPayment) {
            throw new InvalidArgumentException('Target is not a treasury payment.');
        }

        return $target;
    }

    /**
     * @param  array<string, array<array-key, string>>  $errors
     * @return array<string, list<string>>
     */
    private function fields(array $errors): array
    {
        return array_map(static fn (array $messages): array => array_values($messages), $errors);
    }
}
