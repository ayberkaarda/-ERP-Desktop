<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\QuoteStatus;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Services\Machines\QuoteMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Carbon;

/**
 * Quotes: drafts, send/accept/reject/expire, revisions (a copy linked by previous_revision_id that
 * supersedes the old one) and conversion into an order draft. Numbers are assigned when a quote is
 * sent (or accepted/converted unsent).
 */
final class QuoteService extends DocumentService
{
    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly QuoteMachine $machine,
        private readonly SalesSettings $settings,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function create(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): SalesQuote
    {
        return $this->createKeyed('sales_quotes', self::clientId($data), function () use ($data, $lines, $actor, $canOverridePrice): SalesQuote {
            $composed = $this->compose($data, $lines, $canOverridePrice);
            $quote = $this->store->create(new SalesQuote, $composed, [
                'valid_until' => $data['valid_until'] ?? $this->validUntil((string) $composed->header['document_date']),
            ], actor: self::actorId($actor), id: self::clientId($data));
            $this->logOverrides($quote, $composed, $actor);

            return $quote;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(SalesQuote $quote, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $data, $lines, $version, $actor, $canOverridePrice): SalesQuote {
            $quote = $this->lockDraft($quote, $version);
            [$inputs, $kept] = $this->editedLines($quote->lines, $lines);
            $composed = $this->compose($this->mergedHeader($quote, $data), $inputs, $canOverridePrice);
            $extra = array_key_exists('valid_until', $data) ? ['valid_until' => $data['valid_until']] : [];
            $this->store->replace($quote, $composed, $extra, $kept);
            $this->logOverrides($quote, $composed, $actor);

            return $quote;
        });
    }

    public function delete(SalesQuote $quote, ?int $version): void
    {
        Sales::transaction(function () use ($quote, $version): void {
            $quote = $this->lockDraft($quote, $version);
            $quote->delete();
        });
    }

    public function send(SalesQuote $quote, ?int $version, ?Authenticatable $actor): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $version, $actor): SalesQuote {
            $quote = $this->lock($quote, $version);
            $this->assertStatus($quote, [QuoteStatus::Draft], QuoteStatus::Sent->value);
            $this->store->assignNumber($quote, DocumentKind::Quote);
            $quote->sent_at = now();

            return $this->machine->transition($quote, QuoteStatus::Sent, $actor);
        });
    }

    public function accept(SalesQuote $quote, ?int $version, ?Authenticatable $actor): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $version, $actor): SalesQuote {
            $quote = $this->lock($quote, $version);
            $this->assertStatus($quote, [QuoteStatus::Draft, QuoteStatus::Sent], QuoteStatus::Accepted->value);
            $this->assertValid($quote);
            $this->store->assignNumber($quote, DocumentKind::Quote);
            $quote->accepted_at = now();

            return $this->machine->transition($quote, QuoteStatus::Accepted, $actor);
        });
    }

    public function reject(SalesQuote $quote, ?int $version, ?string $reason, ?Authenticatable $actor): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $version, $reason, $actor): SalesQuote {
            $quote = $this->lock($quote, $version);
            $this->assertStatus($quote, [QuoteStatus::Sent], QuoteStatus::Rejected->value);
            $quote->rejected_at = now();
            $quote->rejection_reason = $reason;

            return $this->machine->transition($quote, QuoteStatus::Rejected, $actor);
        });
    }

    public function cancel(SalesQuote $quote, ?int $version, ?Authenticatable $actor): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $version, $actor): SalesQuote {
            $quote = $this->lock($quote, $version);

            return $this->machine->transition($quote, QuoteStatus::Cancelled, $actor);
        });
    }

    /**
     * A new draft revision copying the quote; the old one is cancelled (superseded).
     */
    public function revise(SalesQuote $quote, ?int $version, ?Authenticatable $actor): SalesQuote
    {
        return Sales::transaction(function () use ($quote, $version, $actor): SalesQuote {
            $quote = $this->lock($quote, $version);
            $this->assertStatus($quote, [QuoteStatus::Draft, QuoteStatus::Sent, QuoteStatus::Rejected, QuoteStatus::Expired], 'revised');
            $header = $this->mergedHeader($quote, ['document_date' => now()->toDateString()]);
            $composed = $this->compose($header, $this->storedLines($quote->lines), true);
            $copy = $this->store->create(new SalesQuote, $composed, [
                'revision' => $quote->revision + 1,
                'previous_revision_id' => $quote->id,
                'valid_until' => $this->validUntil((string) $composed->header['document_date']),
            ], actor: self::actorId($actor));
            $this->machine->transition($quote, QuoteStatus::Cancelled, $actor);

            return $copy;
        });
    }

    /**
     * Creates the order draft (prices kept from the quote) and marks the quote converted.
     *
     * @param  array<string, mixed>  $data  document_date, requested_delivery_date, warehouse_id
     */
    public function convert(SalesQuote $quote, array $data, ?int $version, ?Authenticatable $actor): SalesOrder
    {
        return Sales::transaction(function () use ($quote, $data, $version, $actor): SalesOrder {
            $quote = $this->lock($quote, $version);
            $this->assertStatus($quote, [QuoteStatus::Draft, QuoteStatus::Sent, QuoteStatus::Accepted], QuoteStatus::Converted->value);
            $this->assertValid($quote);
            $header = $this->mergedHeader($quote, array_intersect_key($data, array_flip(['document_date', 'warehouse_id'])));
            $header['document_date'] = $data['document_date'] ?? now()->toDateString();
            unset($header['due_date']);
            $lines = [];

            foreach ($quote->lines as $line) {
                $lines[] = [...$this->fixedLine($line, (string) $line->quantity), 'source_line_id' => $line->id];
            }

            $composed = $this->compose($header, $lines, true);
            $order = $this->store->create(new SalesOrder, $composed, [
                'source_type' => 'sales_quote',
                'source_id' => $quote->id,
                'quote_id' => $quote->id,
                'requested_delivery_date' => $data['requested_delivery_date'] ?? null,
            ], actor: self::actorId($actor));

            $this->store->assignNumber($quote, DocumentKind::Quote);
            $quote->converted_order_id = $order->id;
            $this->machine->transition($quote, QuoteStatus::Converted, $actor);

            return $order;
        });
    }

    /** Moves draft and sent quotes past their validity to expired; returns how many. */
    public function expireDue(string $companyId, ?string $today = null): int
    {
        $today ??= now()->toDateString();
        $count = 0;

        $ids = SalesQuote::query()->where('company_id', $companyId)->whereIn('status', [QuoteStatus::Draft->value, QuoteStatus::Sent->value])
            ->whereNotNull('valid_until')->where('valid_until', '<', $today)->pluck('id');

        foreach ($ids as $id) {
            Sales::transaction(function () use ($id, &$count): void {
                $quote = SalesQuote::query()->whereKey($id)->lockForUpdate()->first();

                if ($quote !== null && in_array($quote->status, [QuoteStatus::Draft, QuoteStatus::Sent], true)) {
                    $this->machine->transition($quote, QuoteStatus::Expired);
                    $count++;
                }
            });
        }

        return $count;
    }

    private function assertValid(SalesQuote $quote): void
    {
        if ($quote->valid_until !== null && $quote->valid_until->format('Y-m-d') < now()->toDateString()) {
            Messages::fail('valid_until', 'quote_expired');
        }
    }

    private function validUntil(string $date): string
    {
        return Carbon::instance(new DateTimeImmutable($date))->addDays($this->settings->quoteValidityDays())->toDateString();
    }
}
