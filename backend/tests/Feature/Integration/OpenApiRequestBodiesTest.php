<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;

/**
 * Required and present properties of an operation's JSON request body (refs resolved).
 *
 * @param  array<string, mixed>  $doc
 * @return array{properties: list<string>, required: list<string>}
 */
function requestBody(array $doc, string $path, string $method): array
{
    $resolve = function (array $node) use ($doc): array {
        while (isset($node['$ref'])) {
            $ref = (string) $node['$ref'];
            $node = $doc;
            foreach (explode('/', substr($ref, 2)) as $key) {
                $node = $node[$key];
            }
        }

        return $node;
    };
    $body = $resolve($doc['paths'][$path][$method]['requestBody'] ?? []);
    $schema = $resolve($body['content']['application/json']['schema'] ?? []);

    return ['properties' => array_keys($schema['properties'] ?? []), 'required' => $schema['required'] ?? []];
}

it('documents distinct create and update bodies: version is required on PATCH only', function (): void {
    $path = storage_path('framework/testing/openapi-'.bin2hex(random_bytes(4)).'.json');
    @mkdir(dirname($path), 0777, true);

    try {
        Artisan::call('scramble:export', ['--path' => $path]);
        $doc = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    } finally {
        @unlink($path);
    }

    $pairs = [
        // Parties
        ['/parties', '/parties/{party}', ['name', 'type', 'roles']],
        ['/parties/{party}/addresses', '/parties/{party}/addresses/{child}', ['type', 'line1']],
        ['/parties/{party}/contacts', '/parties/{party}/contacts/{child}', ['name']],
        ['/parties/{party}/bank-accounts', '/parties/{party}/bank-accounts/{child}', ['bank_name', 'iban']],
        // Catalog
        ['/units', '/units/{id}', ['code', 'name']],
        ['/item-categories', '/item-categories/{id}', ['code', 'name']],
        ['/items', '/items/{id}', ['name', 'type', 'base_unit_id']],
        ['/price-lists', '/price-lists/{id}', ['code', 'name', 'currency_code']],
        ['/price-lists/{priceList}/lines', '/price-lists/{priceList}/lines/{id}', ['item_id', 'unit_id', 'price']],
        ['/discount-rules', '/discount-rules/{id}', ['code', 'name', 'scope']],
        // Reference
        ['/payment-terms', '/payment-terms/{id}', ['code', 'name', 'due_days']],
        ['/tax-codes', '/tax-codes/{id}', ['code', 'name', 'type', 'effective_from']],
        ['/warehouses', '/warehouses/{id}', ['code', 'name']],
        ['/warehouses/{warehouse}/locations', '/warehouses/{warehouse}/locations/{id}', ['code', 'name', 'type']],
        ['/cost-centers', '/cost-centers/{id}', ['code', 'name']],
        ['/projects', '/projects/{id}', ['code', 'name']],
    ];

    foreach ($pairs as [$collection, $record, $required]) {
        $create = requestBody($doc, $collection, 'post');
        $update = requestBody($doc, $record, 'patch');

        expect($create['required'])->not->toContain('version')
            ->and($create['required'])->toContain(...$required)
            ->and($update['required'])->toBe(['version'], "PATCH {$record}")
            // The update body still documents the editable fields, as optional.
            ->and($update['properties'])->toContain(...$required);
    }

    expect(requestBody($doc, '/exchange-rates', 'post')['required'])->toContain('currency_code', 'rate_date')->not->toContain('version')
        ->and(requestBody($doc, '/currencies/{id}', 'patch')['required'])->toBe(['version'])
        ->and(requestBody($doc, '/currencies/{id}', 'patch')['properties'])->toContain('is_active');
});
