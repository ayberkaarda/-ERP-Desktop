<?php

declare(strict_types=1);

use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Parties\Contracts\PartyAddressLookup;
use App\Modules\Parties\Models\PartyAddress;
use App\Modules\Reference\Contracts\PaymentTermLookup;
use App\Modules\Reference\Models\PaymentTerm;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

/*
 * Contract additions used by Sales instead of reading other modules' tables (review finding 13).
 */

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
});

it('gives the due days of an active payment term of the company', function (): void {
    $term = SalesKit::in($this->w->company, fn () => PaymentTerm::factory()->create(['due_days' => 45]));
    $lookup = app(PaymentTermLookup::class);

    expect(SalesKit::in($this->w->company, fn () => $lookup->dueDays($term->id)))->toBe(45)
        ->and(SalesKit::in($this->w->company, fn () => $lookup->dueDays((string) Str::uuid7())))->toBeNull()
        ->and(SalesKit::in(SalesKit::company(), fn () => $lookup->dueDays($term->id)))->toBeNull();
});

it('gives the default billing address of a party of the company', function (): void {
    $lookup = app(PartyAddressLookup::class);
    expect(SalesKit::in($this->w->company, fn () => $lookup->billingAddress($this->w->party->id)))->toBeNull();

    SalesKit::in($this->w->company, fn () => PartyAddress::factory()->create([
        'party_id' => $this->w->party->id, 'type' => 'shipping', 'line1' => 'Dock 4', 'country' => 'TR', 'is_default' => true,
    ]));
    SalesKit::in($this->w->company, fn () => PartyAddress::factory()->create([
        'party_id' => $this->w->party->id, 'type' => 'billing', 'line1' => 'Head office', 'city' => 'Izmir', 'country' => 'TR', 'is_default' => true,
    ]));

    $address = SalesKit::in($this->w->company, fn () => $lookup->billingAddress($this->w->party->id));
    expect($address['line1'])->toBe('Head office')->and($address['city'])->toBe('Izmir')->and($address['country'])->toBe('TR')
        ->and(SalesKit::in(SalesKit::company(), fn () => $lookup->billingAddress($this->w->party->id)))->toBeNull();
});

it('reports cost, lots and serials per line of a posting', function (): void {
    $lot = SalesKit::item($this->w->company, ['tracking' => 'lot'], $this->w->unit);
    $serial = SalesKit::item($this->w->company, ['tracking' => 'serial'], $this->w->unit);
    Inv::receive($this->w->company, $this->w->wh->id, $lot->id, '5', '10', ['lotNo' => 'L1']);
    Inv::receive($this->w->company, $this->w->wh->id, $serial->id, '2', '100', ['serials' => ['A', 'B']]);

    $posted = Inv::post($this->w->company, DocumentType::Issue, $this->w->wh->id, [
        new StockPostingLine($lot->id, '3'),
        new StockPostingLine($serial->id, '1', serials: ['B']),
    ]);

    expect($posted->lines)->toHaveCount(2)
        ->and($posted->lines[0]->lineNo)->toBe(1)->and($posted->lines[0]->quantity)->toBe('3.000000')
        ->and($posted->lines[0]->totalCost)->toBe('30.0000')->and($posted->lines[0]->lotNos)->toBe(['L1'])
        ->and($posted->lines[1]->serials)->toBe(['B'])->and($posted->lines[1]->totalCost)->toBe('100.0000');
});
