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
 * concurrent edit moved them to other sources in between, it must not lock those sources after
 * the invoice (that is the update path's order reversed, a deadlock) but answer VERSION_CONFLICT.
 * Committing database: the concurrent edit runs on a second connection.
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
});

afterEach(function (): void {
    DB::disconnect('sales_lock_editor');
});

/**
 * Runs issue() while a committed edit moves the invoice line from delivery 1 to delivery 2 right
 * before the invoice row is locked. Returns the tables locked FOR UPDATE, in order, and the error.
 *
 * @return array{0: list<string>, 1: Throwable|null}
 */
function issueWhileLinesMove(object $test): array
{
    config(['database.connections.sales_lock_editor' => config('database.connections.'.config('database.default'))]);
    $editor = DB::connection('sales_lock_editor');
    $moved = false;
    $locks = [];

    DB::connection()->beforeExecuting(function (string $sql) use (&$moved, $editor, $test): void {
        if (! $moved && str_contains($sql, 'from "sales_invoices"') && str_contains($sql, 'for update')) {
            $moved = true;
            $editor->update(
                'update sales_invoice_lines set delivery_line_id = ?, order_line_id = ? where document_id = ?',
                [$test->d2['lines'][0]['id'], $test->o2['lines'][0]['id'], $test->invoice['id']],
            );
        }
    });
    DB::listen(function ($query) use (&$locks): void {
        if (str_contains($query->sql, 'for update') && preg_match('/from "(sales_invoices|sales_orders|sales_deliveries)"/', $query->sql, $m) === 1) {
            $locks[] = $m[1];
        }
    });

    $error = null;

    try {
        SalesKit::in($test->w->company, fn () => app(InvoiceService::class)->issue(SalesInvoice::query()->findOrFail($test->invoice['id']), null, null, false, $test->w->user));
    } catch (Throwable $e) {
        $error = $e;
    }

    return [$locks, $error];
}

it('never locks a source after the invoice when the lines moved before the invoice lock', function (): void {
    [$locks, $error] = issueWhileLinesMove($this);
    $invoiceAt = array_search('sales_invoices', $locks, true);

    expect($invoiceAt)->not->toBeFalse()
        ->and(array_slice($locks, (int) $invoiceAt + 1))->not->toContain('sales_orders')
        ->and(array_slice($locks, (int) $invoiceAt + 1))->not->toContain('sales_deliveries')
        ->and($error)->toBeInstanceOf(VersionConflictException::class)
        ->and(DB::table('sales_invoices')->where('id', $this->invoice['id'])->value('status'))->toBe('draft');
});

it('issues normally when nothing moved', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
});
