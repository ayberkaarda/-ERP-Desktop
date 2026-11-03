<?php

declare(strict_types=1);

/*
 * The web frontend's list pages and filter lists against contracts/offline-manifest.json and
 * tests/Fixtures/Sync/web-list-queries.json. OfflineManifestQueryTest checks the literal
 * 'filter[x]' strings; this file checks what the pages build from code: DataTable columns that
 * can be sorted, column filters (meta.filter, keyed by meta.filter.key or the column id), the
 * filter and sort allowlists of the sales, purchasing and kit list helpers and the stock document
 * filters. A new sortable column or filter on a mirrored list fails here until the manifest and
 * the fixture name it.
 */

const OQW_FRONTEND = 'frontend/src/features/';

/**
 * DataTable list pages of mirrored lists: file => resource.
 *
 * @var array<string, string>
 */
const OQW_MIRRORED_PAGES = [
    'parties/pages/PartyListPage.tsx' => 'parties',
    'catalog/pages/ItemListPage.tsx' => 'items',
    'catalog/pages/UnitsPage.tsx' => 'units',
    'catalog/pages/PriceListListPage.tsx' => 'price-lists',
    'reference/pages/CurrenciesPage.tsx' => 'currencies',
    'reference/pages/ExchangeRatesPage.tsx' => 'exchange-rates',
    'reference/pages/PaymentTermsPage.tsx' => 'payment-terms',
    'reference/pages/ProjectsPage.tsx' => 'projects',
    'reference/pages/WarehousesPage.tsx' => 'warehouses',
    'sales/quotes/pages/QuoteListPage.tsx' => 'sales-quotes',
    'sales/orders/pages/OrderListPage.tsx' => 'sales-orders',
    'sales/deliveries/pages/DeliveryListPage.tsx' => 'sales-deliveries',
    'sales/invoices/pages/InvoiceListPage.tsx' => 'sales-invoices',
    'sales/returns/pages/ReturnListPage.tsx' => 'sales-returns',
    'purchasing/requests/pages/RequestListPage.tsx' => 'purchase-requests',
    'purchasing/rfqs/pages/RfqListPage.tsx' => 'purchase-rfqs',
    'purchasing/orders/pages/OrderListPage.tsx' => 'purchase-orders',
    'purchasing/receipts/pages/ReceiptListPage.tsx' => 'purchase-receipts',
    'purchasing/invoices/pages/InvoiceListPage.tsx' => 'purchase-invoices',
    'purchasing/returns/pages/ReturnListPage.tsx' => 'purchase-returns',
    'inventory/documents/pages/StockDocumentListPage.tsx' => 'stock-documents',
];

/**
 * DataTable pages whose lists are not mirrored (they stay online-only as a whole).
 *
 * @var list<string>
 */
const OQW_OTHER_PAGES = [
    'accounting/accounts/pages/ChartOfAccountsPage.tsx',
    'accounting/journal/pages/JournalEntryListPage.tsx',
    'catalog/pages/DiscountRulesPage.tsx',
    'inventory/lots/pages/LotsPage.tsx',
    'inventory/lots/pages/SerialsPage.tsx',
    'inventory/reservations/pages/ReservationListPage.tsx',
    'inventory/stock/pages/StockStatusPage.tsx',
    'inventory/warehouses/pages/WarehousesPage.tsx',
];

function oqwRoot(): string
{
    return dirname(__DIR__, 4).'/';
}

function oqwSource(string $file): string
{
    return (string) file_get_contents(oqwRoot().OQW_FRONTEND.$file);
}

/** @return array<string, array<string, mixed>> query section per resource (children flattened) */
function oqwQueries(): array
{
    $manifest = json_decode((string) file_get_contents(oqwRoot().'contracts/offline-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
    $out = [];

    foreach ($manifest['resources'] as $resource) {
        $out[$resource['resource']] = $resource['query'] ?? [];

        foreach ($resource['children'] ?? [] as $child) {
            $out[$child['resource']] = $child['query'] ?? [];
        }
    }

    return $out;
}

/** @return list<array{resource: string, query: string, expect: string, source: string}> */
function oqwFixture(): array
{
    return json_decode((string) file_get_contents(dirname(__DIR__, 2).'/Fixtures/Sync/web-list-queries.json'), true, flags: JSON_THROW_ON_ERROR)['queries'];
}

/**
 * Columns of a DataTable page: id => [sortable, filter key or null].
 *
 * @return array<string, array{sortable: bool, filter: ?string}>
 */
function oqwColumns(string $source): array
{
    $starts = [];
    // Column helpers (col.accessor('x', ...), col.display({ id: 'x' })) and plain column objects
    // ({ id: 'x', ... } or { accessorKey: 'x', ... }).
    preg_match_all("/\\b\\w+\\.(?:accessor|display)\\(|\\{\\s*(?:id|accessorKey):\\s*'/", $source, $matches, PREG_OFFSET_CAPTURE);

    foreach ($matches[0] as [$text, $offset]) {
        $starts[] = $offset;
    }

    $columns = [];

    foreach ($starts as $i => $start) {
        $chunk = substr($source, $start, ($starts[$i + 1] ?? strlen($source)) - $start);

        if (preg_match("/^\\{\\s*id:\\s*'[a-z_]+',\\s*desc:/", $chunk) === 1) {
            continue; // a sort state ({ id, desc }), not a column
        }

        if (preg_match("/^\\w+\\.accessor\\(\\s*'([a-z_]+)'/", $chunk, $id) !== 1
            && preg_match("/\\bid:\\s*'([a-z_]+)'/", $chunk, $id) !== 1
            && preg_match("/\\baccessorKey:\\s*'([a-z_]+)'/", $chunk, $id) !== 1) {
            continue;
        }

        $filter = null;

        if (preg_match('/\bfilter:\s*\{(.*?)\boptions\b/s', $chunk, $block) === 1) {
            $filter = preg_match("/\\bkey:\\s*'([a-z_]+)'/", $block[1], $key) === 1 ? $key[1] : $id[1];
        }

        $columns[$id[1]] = ['sortable' => preg_match('/\benableSorting:\s*true\b/', $chunk) === 1, 'filter' => $filter];
    }

    return $columns;
}

/**
 * Names in the fixture rows of one resource, optionally only those from one source file.
 *
 * @return array{sort: array<string, true>, filter: array<string, true>}
 */
function oqwFixtureNames(string $resource, ?string $source = null): array
{
    $names = ['sort' => [], 'filter' => []];

    foreach (oqwFixture() as $entry) {
        if ($entry['resource'] !== $resource || ($source !== null && $entry['source'] !== $source)) {
            continue;
        }

        foreach (explode('&', $entry['query']) as $part) {
            [$key, $value] = array_pad(explode('=', $part, 2), 2, '');

            if ($key === 'sort') {
                foreach (array_filter(explode(',', $value)) as $sort) {
                    $names['sort'][ltrim($sort, '-')] = true;
                }
            } elseif (preg_match('/^filter\[([a-z_]+)\]$/', $key, $match) === 1) {
                $names['filter'][$match[1]] = true;
            }
        }
    }

    return $names;
}

/** @param array<string, mixed> $query */
function oqwKnowsFilter(array $query, string $name): bool
{
    return isset($query['filters'][$name]) || in_array("filter[{$name}]", array_column($query['online_only'] ?? [], 'param'), true);
}

/** @return list<string> the quoted names of a `const NAME = [...]` or `NAME: [...]` list */
function oqwList(string $source, string $pattern): array
{
    expect(preg_match($pattern, $source, $match))->toBe(1, $pattern);
    preg_match_all("/'([a-z_]+)'/", $match[1], $names);

    return $names[1];
}

beforeEach(function (): void {
    if (! is_dir(oqwRoot().OQW_FRONTEND)) {
        $this->markTestSkipped('frontend sources not present');
    }
});

it('knows every DataTable page as a mirrored list or as an online-only one', function (): void {
    $pages = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(oqwRoot().OQW_FRONTEND, FilesystemIterator::SKIP_DOTS));

    foreach ($iterator as $file) {
        $path = str_replace('\\', '/', (string) $file);

        if (! str_ends_with($path, '.tsx') || preg_match('#\.test\.tsx$|/_showcase/#', $path) === 1) {
            continue;
        }

        $columns = oqwColumns((string) file_get_contents($path));

        if (array_filter($columns, static fn (array $c): bool => $c['sortable'] || $c['filter'] !== null) !== []) {
            $pages[] = substr($path, strlen(oqwRoot().OQW_FRONTEND));
        }
    }

    sort($pages);
    $known = [...array_keys(OQW_MIRRORED_PAGES), ...OQW_OTHER_PAGES];
    sort($known);

    expect($pages)->toBe($known);
});

it('declares and lists in the fixture every sortable column and column filter of a mirrored page', function (): void {
    $queries = oqwQueries();
    $missing = [];

    foreach (OQW_MIRRORED_PAGES as $file => $resource) {
        $query = $queries[$resource];
        $sent = oqwFixtureNames($resource, OQW_FRONTEND.$file);
        $columns = oqwColumns(oqwSource($file));

        expect($columns)->not->toBeEmpty($file);

        foreach ($columns as $id => $column) {
            if ($column['sortable'] && ! isset($query['sort'][$id])) {
                $missing[] = "{$file}: sortable {$id} is not a declared sort";
            }

            if ($column['sortable'] && ! isset($sent['sort'][$id])) {
                $missing[] = "{$file}: sortable {$id} has no fixture row from this page";
            }

            if ($column['filter'] !== null && ! oqwKnowsFilter($query, $column['filter'])) {
                $missing[] = "{$file}: filter {$column['filter']} is not declared";
            }

            if ($column['filter'] !== null && ! isset($sent['filter'][$column['filter']])) {
                $missing[] = "{$file}: filter {$column['filter']} has no fixture row from this page";
            }
        }
    }

    expect($missing)->toBe([]);
});

it('declares every name of the list helpers allowlists', function (): void {
    $queries = oqwQueries();
    $sales = oqwSource('sales/shared/lib/listFilters.ts');
    $purchasing = oqwSource('purchasing/shared/lib/listFilters.ts');
    $kit = oqwSource('sales/invoices/kit/listFilters.ts');
    $stock = oqwSource('inventory/documents/pages/StockDocumentListPage.tsx');
    $kitFilters = [...oqwList($kit, '/COMMON_FILTERS = \[(.*?)\]/s'), 'status'];
    $checks = [
        // [resources, filter names, sort names]
        [['sales-quotes', 'sales-orders'], oqwList($sales, '/LIST_FILTERS = \[(.*?)\]/s'), oqwList($sales, '/LIST_SORTS = \[(.*?)\]/s')],
        [['purchase-requests', 'purchase-rfqs', 'purchase-orders'], oqwList($purchasing, '/LIST_FILTERS = \[(.*?)\]/s'), []],
        [['purchase-requests'], [], oqwList($purchasing, '/\brequest: \[(.*?)\]/s')],
        [['purchase-rfqs'], [], oqwList($purchasing, '/\brfq: \[(.*?)\]/s')],
        [['purchase-orders'], [], oqwList($purchasing, '/\border: \[(.*?)\]/s')],
        [['sales-deliveries', 'sales-returns', 'purchase-receipts', 'purchase-returns'], $kitFilters, []],
        [['sales-invoices'], [...$kitFilters, ...oqwList(oqwSource('sales/invoices/pages/InvoiceListPage.tsx'), '/useListFilters\\(.*?\\{ sort: .*?\\},\\s*\\[(.*?)\\]/s')], []],
        [['purchase-invoices'], [...$kitFilters, ...oqwList(oqwSource('purchasing/invoices/pages/InvoiceListPage.tsx'), '/useListFilters\\(.*?\\{ sort: .*?\\},\\s*\\[(.*?)\\]/s')], []],
        [['stock-documents'], oqwList($stock, '/const FILTERS = \[(.*?)\]/s'), []],
    ];
    $missing = [];

    foreach ($checks as [$resources, $filters, $sorts]) {
        foreach ($resources as $resource) {
            $query = $queries[$resource];
            $sent = oqwFixtureNames($resource);

            foreach ($filters as $filter) {
                if (! oqwKnowsFilter($query, $filter)) {
                    $missing[] = "{$resource}: filter {$filter} is not declared";
                }

                if (! isset($sent['filter'][$filter])) {
                    $missing[] = "{$resource}: filter {$filter} has no fixture row";
                }
            }

            foreach ($sorts as $sort) {
                if (! isset($query['sort'][$sort])) {
                    $missing[] = "{$resource}: sort {$sort} is not declared";
                }

                if (! isset($sent['sort'][$sort])) {
                    $missing[] = "{$resource}: sort {$sort} has no fixture row";
                }
            }
        }
    }

    expect($missing)->toBe([]);
});

it('keeps a fixture row for every literal filter of each file that reads a mirrored list', function (): void {
    $fixture = oqwFixture();
    $other = json_decode((string) file_get_contents(dirname(__DIR__, 2).'/Fixtures/Sync/web-list-queries.json'), true, flags: JSON_THROW_ON_ERROR)['other_endpoints'];
    $manifest = json_decode((string) file_get_contents(oqwRoot().'contracts/offline-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
    $paths = array_map(static fn (array $r): string => substr($r['path'], strlen('/api/v1')), $manifest['resources']);
    $sources = array_unique(array_column($fixture, 'source'));
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(oqwRoot().'frontend/src', FilesystemIterator::SKIP_DOTS));

    // Every file that reads a mirrored list path, whether or not the fixture names it.
    foreach ($iterator as $file) {
        $path = str_replace('\\', '/', (string) $file);

        if (preg_match('/\.tsx?$/', $path) !== 1 || preg_match('#\.test\.tsx?$|/test/|/_showcase/#', $path) === 1) {
            continue;
        }

        $text = (string) file_get_contents($path);

        if (array_any($paths, static fn (string $p): bool => str_contains($text, "'{$p}'") || str_contains($text, "`{$p}/"))) {
            $sources[] = substr($path, strlen(oqwRoot()));
        }
    }

    $missing = [];

    foreach (array_unique($sources) as $source) {
        preg_match_all("/'filter\\[([a-z_]+)\\]'/", (string) file_get_contents(oqwRoot().$source), $matches);

        foreach (array_unique($matches[1]) as $filter) {
            $rows = array_filter($fixture, static fn (array $q): bool => $q['source'] === $source && str_contains($q['query'], "filter[{$filter}]="));
            $elsewhere = array_filter($other, static fn (array $o): bool => $o['source'] === $source && $o['filter'] === $filter);

            if ($rows === [] && $elsewhere === []) {
                $missing[] = "{$source}: filter[{$filter}]";
            }
        }
    }

    expect($missing)->toBe([]);
});
