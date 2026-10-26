<?php

declare(strict_types=1);

use App\Core\Documents\VersionConflictException;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Services\InvoiceService;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

/*
 * Lock order of invoice paths: sources (orders, then deliveries) before the invoice, as
 * InvoiceService::update does. issue() re-reads the lines once the invoice is locked; when a
 * concurrent edit moved them to other sources in between, those are taken with NOWAIT: it never
 * waits for a source while holding the invoice (the update path's order reversed, a deadlock).
 * Free sources are taken and the issue goes on; a held one answers VERSION_CONFLICT.
 * Committing database: the concurrent edit and the holder run on their own connections.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
    $o1 = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    $o2 = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    $this->d1 = SalesKit::deliver($this->w, $o1['id'], [$o1['lines'][0]['id'] => '1']);
    $this->d2 = SalesKit::deliver($this->w, $o2['id'], [$o2['lines'][0]['id'] => '1']);
    $this->o2 = $o2;
    $this->invoice = SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$this->d1['id']}/invoice", ['document_date' => '2027-06-13'])
        ->assertCreated()->json('data');

    foreach (['sales_lock_editor', 'sales_lock_holder'] as $name) {
        config(["database.connections.{$name}" => config('database.connections.'.config('database.default'))]);
    }
});

afterEach(function (): void {
    DB::disconnect('sales_lock_editor');
    DB::disconnect('sales_lock_holder');
});

/**
 * Runs issue() while a committed edit moves the invoice line from delivery 1 to delivery 2 right
 * before the invoice row is locked. Returns the row locks taken after the invoice lock
 * (table => NOWAIT or not) and the error.
 *
 * @return array{0: list<array{0: string, 1: bool}>, 1: Throwable|null}
 */
function issueWhileLinesMove(object $test): array
{
    $editor = DB::connection('sales_lock_editor');
    $moved = false;
    $invoiceLocked = false;
    $after = [];

    DB::connection()->beforeExecuting(function (string $sql) use (&$moved, $editor, $test): void {
        if (! $moved && str_contains($sql, 'from "sales_invoices"') && str_contains($sql, 'for update')) {
            $moved = true;
            $editor->update(
                'update sales_invoice_lines set delivery_line_id = ?, order_line_id = ? where document_id = ?',
                [$test->d2['lines'][0]['id'], $test->o2['lines'][0]['id'], $test->invoice['id']],
            );
        }
    });
    // A lock that has to wait fails after 2s instead of hanging the test.
    DB::statement("SET lock_timeout = '2s'");
    $record = function (string $sql) use (&$invoiceLocked, &$after): void {
        if (! str_contains($sql, 'for update') || preg_match('/from "(sales_invoices|sales_orders|sales_deliveries)"/', $sql, $m) !== 1) {
            return;
        }

        if ($invoiceLocked) {
            $after[] = [$m[1], str_contains($sql, 'nowait')];
        }

        $invoiceLocked = $invoiceLocked || $m[1] === 'sales_invoices';
    };
    DB::connection()->beforeExecuting(fn (string $sql) => $record($sql));

    $error = null;

    try {
        SalesKit::in($test->w->company, fn () => app(InvoiceService::class)->issue(SalesInvoice::query()->findOrFail($test->invoice['id']), null, null, false, $test->w->user));
    } catch (Throwable $e) {
        $error = $e;
    } finally {
        DB::statement('SET lock_timeout = 0');
    }

    return [$after, $error];
}

it('answers VERSION_CONFLICT instead of waiting for a moved source while holding the invoice', function (): void {
    $holder = DB::connection('sales_lock_holder');
    $holder->beginTransaction();
    $holder->select('select id from sales_orders where id = ? for update', [$this->o2['id']]);

    try {
        [$after, $error] = issueWhileLinesMove($this);
    } finally {
        $holder->rollBack();
    }

    $sources = array_filter($after, fn (array $lock): bool => $lock[0] !== 'sales_invoices');

    expect($error)->toBeInstanceOf(VersionConflictException::class)
        ->and($sources)->not->toBeEmpty()
        ->and(array_filter($sources, fn (array $lock): bool => ! $lock[1]))->toBe([])
        ->and(DB::table('sales_invoices')->where('id', $this->invoice['id'])->value('status'))->toBe('draft');
});

it('issues against the moved sources when they are free, still without waiting', function (): void {
    [$after, $error] = issueWhileLinesMove($this);
    $sources = array_values(array_filter($after, fn (array $lock): bool => $lock[0] !== 'sales_invoices'));

    // The moved source is acquired with NOWAIT; later re-locks of rows already held never wait.
    expect($error)->toBeNull()
        ->and($sources[0] ?? null)->toBe(['sales_orders', true])
        ->and(DB::table('sales_invoices')->where('id', $this->invoice['id'])->value('status'))->toBe('issued')
        ->and((string) DB::table('sales_order_lines')->where('id', $this->o2['lines'][0]['id'])->value('invoiced_quantity'))->toBe('1.000000');
});

it('issues normally when nothing moved', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
});
