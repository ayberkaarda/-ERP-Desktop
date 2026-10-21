<?php

declare(strict_types=1);

use App\Modules\Inventory\Enums\DocumentType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company)->id;
    $this->item = Inv::item($this->company)->id;
});

it('values a worked moving average example and keeps the stock account equal to the valuation', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '10', '10');
    Inv::receive($this->company, $this->wh, $this->item, '5', '16');

    // (100 + 80) / 15 = 12
    expect(Inv::valuation($this->company, $this->item, $this->wh))->toBe(['quantity' => '15.000000', 'value' => '180.0000', 'avg_cost' => '12.000000'])
        ->and(Books::balance($this->company, '153'))->toBe('180.0000')
        ->and(Books::balance($this->company, '397'))->toBe('-180.0000');

    $issue = Inv::issue($this->company, $this->wh, $this->item, '6');
    expect($issue->totalCost)->toBe('72.0000')
        ->and(Inv::valuation($this->company, $this->item, $this->wh))->toBe(['quantity' => '9.000000', 'value' => '108.0000', 'avg_cost' => '12.000000']);

    // (108 + 60) / 12 = 14
    Inv::receive($this->company, $this->wh, $this->item, '3', '20');
    expect(Inv::valuation($this->company, $this->item, $this->wh)['avg_cost'])->toBe('14.000000');

    // The movement that empties the stock takes the remaining value.
    $last = Inv::issue($this->company, $this->wh, $this->item, '12');
    expect($last->totalCost)->toBe('168.0000')
        ->and(Inv::valuation($this->company, $this->item, $this->wh)['value'])->toBe('0.0000')
        ->and(Books::balance($this->company, '153'))->toBe('0.0000')
        ->and(Books::balance($this->company, '621'))->toBe('240.0000');
});

it('leaves no residue at zero quantity when the average does not divide evenly', function (): void {
    Inv::post($this->company, DocumentType::Receipt, $this->wh, [Inv::line($this->item, '3', '3.333333')]);
    $costs = [];

    foreach ([1, 2, 3] as $n) {
        $costs[] = Inv::issue($this->company, $this->wh, $this->item, '1')->totalCost;
    }

    expect($costs)->toBe(['3.3333', '3.3333', '3.3334'])
        ->and(Inv::valuation($this->company, $this->item, $this->wh)['value'])->toBe('0.0000')
        ->and(Books::balance($this->company, '153'))->toBe('0.0000');
});

it('values a worked FIFO example with one movement per consumed layer', function (): void {
    Inv::fifo($this->company);
    Inv::receive($this->company, $this->wh, $this->item, '10', '10', date: '2027-06-01');
    Inv::receive($this->company, $this->wh, $this->item, '5', '16', date: '2027-06-02');

    $issue = Inv::issue($this->company, $this->wh, $this->item, '12');
    $movements = DB::table('stock_movements')->where('document_id', $issue->documentId)->orderBy('seq')->get(['quantity', 'unit_cost', 'total_cost', 'cost_layer_id']);

    // 10 x 10 + 2 x 16 = 132
    expect($issue->totalCost)->toBe('132.0000')
        ->and($movements)->toHaveCount(2)
        ->and($movements[0]->quantity)->toBe('10.000000')->and($movements[0]->total_cost)->toBe('100.0000')
        ->and($movements[1]->quantity)->toBe('2.000000')->and($movements[1]->total_cost)->toBe('32.0000')
        ->and($movements[1]->cost_layer_id)->not->toBeNull()
        ->and(Inv::valuation($this->company, $this->item, $this->wh))->toBe(['quantity' => '3.000000', 'value' => '48.0000', 'avg_cost' => '16.000000'])
        ->and(DB::table('stock_cost_layers')->where('item_id', $this->item)->sum('remaining_value'))->toBe('48.0000')
        ->and(Books::balance($this->company, '153'))->toBe('48.0000');

    // A new receipt opens a layer behind the remaining one.
    Inv::receive($this->company, $this->wh, $this->item, '2', '19', date: '2027-06-03');
    expect(Inv::issue($this->company, $this->wh, $this->item, '4')->totalCost)->toBe('67.0000'); // 3 x 16 + 1 x 19
});

it('moves stock between warehouses at source cost', function (): void {
    $second = Inv::warehouse($this->company, 'SECOND')->id;
    Inv::receive($this->company, $this->wh, $this->item, '10', '10');
    Inv::receive($this->company, $second, $this->item, '10', '20');

    $transfer = Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->item, '5')], target: $second);

    expect($transfer->journalEntryId)->toBeNull()
        ->and(Inv::valuation($this->company, $this->item, $this->wh))->toBe(['quantity' => '5.000000', 'value' => '50.0000', 'avg_cost' => '10.000000'])
        // (200 + 50) / 15
        ->and(Inv::valuation($this->company, $this->item, $second))->toBe(['quantity' => '15.000000', 'value' => '250.0000', 'avg_cost' => '16.666667'])
        ->and(Books::balance($this->company, '153'))->toBe('300.0000');
});

it('refuses a valuation method change once movements exist', function (): void {
    $admin = Actors::user(['settings.view', 'settings.update']);
    Books::as($admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['inventory.valuation_method' => 'fifo']])->assertOk();
    Books::as($admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['inventory.valuation_method' => 'moving_average']])->assertOk();

    Inv::receive($this->company, $this->wh, $this->item, '1', '1');

    Books::as($admin, $this->company)->patchJson('/api/v1/settings', ['settings' => ['inventory.valuation_method' => 'fifo']])->assertStatus(422);
});
