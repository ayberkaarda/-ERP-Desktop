<?php

declare(strict_types=1);

use App\Core\Http\ApiException;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Models\DiscountRule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->units = [
        'pcs' => $pcs = Catalog::unit($this->company, 'PCS'),
        'box' => $box = Catalog::unit($this->company, 'BOX'),
        'kg' => Catalog::unit($this->company, 'KG'),
    ];
    $this->categories = ['root' => $root = Catalog::category($this->company, 'ROOT')];
    $this->categories['child'] = Catalog::category($this->company, 'CHILD', $root);
    $this->item = Catalog::item($this->company, $pcs, ['category_id' => $this->categories['child']->id]);
    Catalog::itemUnit($this->company, $this->item, $box, '12');
    $this->variant = Catalog::variant($this->company, $this->item, 'V-RED');
    $this->party = (string) Str::uuid7();
});

/**
 * Builds lists, lines and rules from a scenario and resolves one query.
 *
 * @param  array<string, mixed>  $s
 * @return array{0: array<string, mixed>, 1: array<string, string>}
 */
function resolveScenario(array $s): array
{
    $t = test();
    $listIds = [];
    $partyLists = [];

    foreach ($s['lists'] ?? [] as $key => $spec) {
        $list = Catalog::priceList($t->company, [
            'currency_code' => $spec['currency'] ?? 'TRY',
            'is_default' => $spec['default'] ?? false,
            'is_active' => $spec['active'] ?? true,
            'tax_inclusive' => $spec['tax_inclusive'] ?? false,
            'valid_from' => $spec['from'] ?? null,
            'valid_to' => $spec['to'] ?? null,
        ]);
        $listIds[$list->id] = $key;

        if ($spec['party'] ?? false) {
            $partyLists[$t->party] = $list->id;
        }

        foreach ($spec['lines'] ?? [] as $line) {
            Catalog::line($t->company, $list, $t->item, $t->units[$line['unit'] ?? 'pcs'], $line['price'], [
                'min_qty' => $line['min'] ?? '0',
                'variant_id' => ($line['variant'] ?? false) ? $t->variant->id : null,
                'valid_from' => $line['from'] ?? null,
                'valid_to' => $line['to'] ?? null,
            ]);
        }
    }

    Catalog::fakePartyLists($partyLists);
    $ruleCodes = [];

    foreach ($s['rules'] ?? [] as $code => $rule) {
        [$scope, $ref] = array_pad(explode(':', $rule['scope'] ?? 'all'), 2, null);
        $created = Catalog::in($t->company, fn () => DiscountRule::query()->create([
            'code' => $code,
            'name' => $code,
            'scope' => $scope,
            'scope_ref' => match ($scope) {
                'item' => $t->item->id,
                'category' => $t->categories[$ref]->id,
                default => null,
            },
            'party_id' => ($rule['party'] ?? false) || $scope === 'party' ? $t->party : null,
            'discount_percent' => $rule['percent'],
            'priority' => $rule['priority'] ?? 0,
            'stackable' => $rule['stackable'] ?? false,
            'min_qty' => $rule['min'] ?? '0',
            'valid_from' => $rule['from'] ?? null,
            'valid_to' => $rule['to'] ?? null,
            'is_active' => $rule['active'] ?? true,
        ]));
        $ruleCodes[$created->id] = $code;
    }

    $q = $s['query'] ?? [];
    $result = Catalog::in($t->company, fn () => app(PriceResolver::class)->resolve(
        $t->item->id,
        ($q['variant'] ?? false) ? $t->variant->id : null,
        ($q['party'] ?? false) ? $t->party : null,
        $q['qty'] ?? '1',
        $t->units[$q['unit'] ?? 'pcs']->id,
        Carbon::parse($q['date'] ?? '2026-06-15'),
        $q['currency'] ?? 'TRY',
    ))->toArray();

    $result['list_key'] = $result['price_list_id'] === null ? null : $listIds[$result['price_list_id']];
    $result['rule_codes'] = array_map(fn (string $id): string => $ruleCodes[$id], $result['discount_rule_ids']);

    return [$result, $listIds];
}

$ladder = ['default' => ['default' => true, 'lines' => [
    ['price' => '10'], ['min' => '10', 'price' => '9'], ['min' => '100', 'price' => '8'],
]]];
$hundred = ['default' => ['default' => true, 'lines' => [['price' => '100']]]];

dataset('pricing scenarios', [
    // Price lists and lines.
    'default list base price' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]]]],
        ['unit_price' => '10.000000', 'net_unit_price' => '10.000000', 'source' => 'default_price_list', 'list_key' => 'default', 'discount_percent' => '0.0000', 'rule_codes' => [], 'tax_inclusive' => false]],
    'ladder below the first break' => [['lists' => $ladder, 'query' => ['qty' => '9']], ['unit_price' => '10.000000']],
    'ladder exactly at a break' => [['lists' => $ladder, 'query' => ['qty' => '10']], ['unit_price' => '9.000000']],
    'ladder above the top break' => [['lists' => $ladder, 'query' => ['qty' => '150']], ['unit_price' => '8.000000']],
    'qty converted to the line unit for min_qty' => [['lists' => $ladder, 'query' => ['qty' => '1', 'unit' => 'box']],
        ['unit_price' => '108.000000', 'list_key' => 'default']],
    'line in the requested unit wins an equal min_qty' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['unit' => 'box', 'price' => '100']]]], 'query' => ['unit' => 'box']],
        ['unit_price' => '100.000000']],
    'same lines priced per piece' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['unit' => 'box', 'price' => '100']]]]],
        ['unit_price' => '10.000000']],
    'box price converted down to pieces' => [['lists' => ['default' => ['default' => true, 'lines' => [['unit' => 'box', 'price' => '100']]]]],
        ['unit_price' => '8.333333']],
    'lines in unconvertible units are ignored' => [['lists' => ['default' => ['default' => true, 'lines' => [['unit' => 'kg', 'price' => '1']]]]],
        ['unit_price' => null, 'source' => 'none', 'list_key' => null]],
    'variant line beats the generic line' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['variant' => true, 'price' => '12']]]], 'query' => ['variant' => true]],
        ['unit_price' => '12.000000']],
    'variant lines never apply without a variant' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['variant' => true, 'price' => '12']]]]],
        ['unit_price' => '10.000000']],
    'party list beats the default list' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]], 'party' => ['party' => true, 'lines' => [['price' => '7']]]], 'query' => ['party' => true]],
        ['unit_price' => '7.000000', 'source' => 'party_price_list', 'list_key' => 'party']],
    'party list is not used for other parties' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]], 'party' => ['party' => true, 'lines' => [['price' => '7']]]]],
        ['unit_price' => '10.000000', 'source' => 'default_price_list']],
    'party list without a matching line falls back' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]], 'party' => ['party' => true, 'lines' => [['variant' => true, 'price' => '7']]]], 'query' => ['party' => true]],
        ['unit_price' => '10.000000', 'source' => 'default_price_list', 'list_key' => 'default']],
    'party list in another currency is skipped' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]], 'party' => ['party' => true, 'currency' => 'USD', 'lines' => [['price' => '7']]]], 'query' => ['party' => true]],
        ['unit_price' => '10.000000', 'list_key' => 'default']],
    'expired line gives way to the current one' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10', 'to' => '2026-05-31'], ['price' => '11', 'from' => '2026-06-01']]]]],
        ['unit_price' => '11.000000']],
    'future line does not apply yet' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['price' => '11', 'from' => '2026-07-01']]]]],
        ['unit_price' => '10.000000']],
    'latest valid_from wins a tie' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['price' => '11', 'from' => '2026-06-01']]]]],
        ['unit_price' => '11.000000']],
    'list outside its validity window' => [['lists' => ['default' => ['default' => true, 'to' => '2026-05-31', 'lines' => [['price' => '10']]]]],
        ['unit_price' => null, 'net_unit_price' => null, 'source' => 'none', 'list_key' => null, 'tax_inclusive' => null]],
    'inactive default list' => [['lists' => ['default' => ['default' => true, 'active' => false, 'lines' => [['price' => '10']]]]],
        ['unit_price' => null, 'source' => 'none']],
    'non-default list is never a fallback' => [['lists' => ['other' => ['lines' => [['price' => '10']]]]],
        ['unit_price' => null, 'source' => 'none']],
    'no currency conversion' => [['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10']]]], 'query' => ['currency' => 'USD']],
        ['unit_price' => null, 'source' => 'none', 'currency' => 'USD']],
    'tax_inclusive flag is passed through' => [['lists' => ['default' => ['default' => true, 'tax_inclusive' => true, 'lines' => [['price' => '118']]]]],
        ['unit_price' => '118.000000', 'tax_inclusive' => true]],
    // Discount rules.
    'higher priority wins' => [['lists' => $hundred, 'rules' => ['LOW' => ['percent' => '10'], 'HIGH' => ['percent' => '5', 'priority' => 1]]],
        ['discount_percent' => '5.0000', 'rule_codes' => ['HIGH'], 'net_unit_price' => '95.000000']],
    'narrower scope wins equal priority' => [['lists' => $hundred, 'rules' => ['ALL' => ['percent' => '10'], 'CAT' => ['percent' => '7', 'scope' => 'category:root'], 'ITEM' => ['percent' => '5', 'scope' => 'item']]],
        ['discount_percent' => '5.0000', 'rule_codes' => ['ITEM']]],
    'ancestor categories apply' => [['lists' => $hundred, 'rules' => ['CAT' => ['percent' => '7', 'scope' => 'category:root']]],
        ['discount_percent' => '7.0000', 'rule_codes' => ['CAT']]],
    'deeper category wins over its ancestor' => [['lists' => $hundred, 'rules' => ['ROOT' => ['percent' => '7', 'scope' => 'category:root'], 'CHILD' => ['percent' => '3', 'scope' => 'category:child']]],
        ['discount_percent' => '3.0000', 'rule_codes' => ['CHILD']]],
    'party-specific rule wins a tie' => [['lists' => $hundred, 'rules' => ['ANY' => ['percent' => '10'], 'MINE' => ['percent' => '4', 'party' => true]], 'query' => ['party' => true]],
        ['discount_percent' => '4.0000', 'rule_codes' => ['MINE']]],
    'party rules need that party' => [['lists' => $hundred, 'rules' => ['P' => ['percent' => '20', 'scope' => 'party'], 'NARROW' => ['percent' => '9', 'scope' => 'item', 'party' => true]]],
        ['discount_percent' => '0.0000', 'rule_codes' => []]],
    'party scope applies to its party' => [['lists' => $hundred, 'rules' => ['P' => ['percent' => '20', 'scope' => 'party']], 'query' => ['party' => true]],
        ['discount_percent' => '20.0000', 'rule_codes' => ['P']]],
    'rule min_qty is compared in base units' => [['lists' => $hundred, 'rules' => ['TEN' => ['percent' => '10', 'min' => '10']], 'query' => ['unit' => 'box']],
        ['unit_price' => '1200.000000', 'net_unit_price' => '1080.000000', 'discount_percent' => '10.0000']],
    'rule min_qty not reached' => [['lists' => $hundred, 'rules' => ['TEN' => ['percent' => '10', 'min' => '10']], 'query' => ['qty' => '9']],
        ['discount_percent' => '0.0000', 'net_unit_price' => '100.000000']],
    'non-stackable winner applies alone' => [['lists' => $hundred, 'rules' => ['A' => ['percent' => '10', 'priority' => 2], 'B' => ['percent' => '5', 'priority' => 1, 'stackable' => true]]],
        ['discount_percent' => '10.0000', 'rule_codes' => ['A']]],
    'stackable winner compounds with stackable rules only' => [['lists' => $hundred, 'rules' => [
        'A' => ['percent' => '10', 'priority' => 2, 'stackable' => true],
        'B' => ['percent' => '5', 'priority' => 1, 'stackable' => true],
        'C' => ['percent' => '20', 'stackable' => false],
    ]], ['discount_percent' => '14.5000', 'net_unit_price' => '85.500000', 'rule_codes' => ['A', 'B']]],
    'expired, future and inactive rules are ignored' => [['lists' => $hundred, 'rules' => [
        'OLD' => ['percent' => '10', 'to' => '2026-05-01'], 'LATER' => ['percent' => '10', 'from' => '2026-07-01'], 'OFF' => ['percent' => '5', 'active' => false],
    ]], ['discount_percent' => '0.0000', 'rule_codes' => []]],
    'equal rules fall back to code order' => [['lists' => $hundred, 'rules' => ['ZED' => ['percent' => '1'], 'ABC' => ['percent' => '2']]],
        ['discount_percent' => '2.0000', 'rule_codes' => ['ABC']]],
    'discount is reported without a price' => [['rules' => ['ALL' => ['percent' => '10']]],
        ['unit_price' => null, 'net_unit_price' => null, 'source' => 'none', 'discount_percent' => '10.0000', 'rule_codes' => ['ALL']]],
]);

it('resolves prices with deterministic precedence', function (array $scenario, array $expected): void {
    [$result] = resolveScenario($scenario);

    foreach ($expected as $key => $value) {
        expect($result[$key])->toBe($value, "{$key} differs");
    }

    expect($result['currency'])->toBe($expected['currency'] ?? 'TRY');
})->with('pricing scenarios');

it('returns the same answer for the same data', function (): void {
    $scenario = ['lists' => ['default' => ['default' => true, 'lines' => [['price' => '10'], ['price' => '10.5', 'min' => '1']]]],
        'rules' => ['A' => ['percent' => '3'], 'B' => ['percent' => '3']]];
    [$first] = resolveScenario($scenario);

    $again = Catalog::in($this->company, fn () => app(PriceResolver::class)->resolve(
        $this->item->id, null, null, '1', $this->units['pcs']->id, Carbon::parse('2026-06-15'), 'TRY',
    ))->toArray();

    expect($again['price_list_line_id'])->toBe($first['price_list_line_id'])
        ->and($again['discount_rule_ids'])->toBe($first['discount_rule_ids'])
        ->and($first['unit_price'])->toBe('10.500000')
        ->and($first['rule_codes'])->toBe(['A']);
});

it('rejects unusable items, variants, units and quantities', function (): void {
    $resolve = fn (array $o) => Catalog::in($this->company, fn () => app(PriceResolver::class)->resolve(
        $o['item'] ?? $this->item->id, $o['variant'] ?? null, null, $o['qty'] ?? '1', $o['unit'] ?? $this->units['pcs']->id, Carbon::parse('2026-06-15'), 'TRY',
    ));
    $other = Catalog::item($this->company, $this->units['pcs']);
    $foreignVariant = Catalog::variant($this->company, $other, 'OTHER');

    foreach ([
        ['item' => (string) Str::uuid7()], ['item' => 'nope'], ['variant' => $foreignVariant->id],
        ['unit' => $this->units['kg']->id], ['qty' => '0'], ['qty' => '-1'], ['qty' => 'abc'],
    ] as $case) {
        try {
            $resolve($case);
            $this->fail('No error for '.json_encode($case));
        } catch (ValidationException|ApiException $e) {
            // Both render as 422 VALIDATION_ERROR.
            expect($e instanceof ApiException ? $e->status() : $e->status)->toBe(422);
        }
    }
});
