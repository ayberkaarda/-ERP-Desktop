<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Enums\NormalBalance;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Support\Ledger;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use JsonException;

/**
 * Copies the TDHP template into the active company's chart. Entries of the other 7/A-7/B scheme
 * are left out; existing codes are never touched (idempotent). Accounts that receive sub-accounts
 * are written non-postable; an existing postable parent is turned into a heading only while unused.
 */
final class ChartSeeder
{
    public function __construct(private readonly CompanyContext $company) {}

    /**
     * @return array{created: int, skipped: int, invalid: int, available: bool}
     */
    public function seed(ExpenseScheme $scheme, ?string $path = null): array
    {
        $entries = $this->load($path);

        if ($entries === null) {
            return ['created' => 0, 'skipped' => 0, 'invalid' => 0, 'available' => false];
        }

        return Ledger::transaction(function () use ($entries, $scheme): array {
            Ledger::lock('accounts');
            $company = $this->company->id();
            $invalid = 0;
            $template = [];

            foreach ($entries as $entry) {
                $normalized = self::normalize($entry);

                if ($normalized === null) {
                    $invalid++;

                    continue;
                }

                if ($normalized['scheme'] === null || $normalized['scheme'] === $scheme->value) {
                    $template[$normalized['code']] = $normalized;
                }
            }

            /** @var array<string, array{id: string, level: int, is_postable: bool}> $known */
            $known = Account::query()->get(['id', 'code', 'level', 'is_postable'])
                ->mapWithKeys(fn (Account $a): array => [$a->code => ['id' => $a->id, 'level' => $a->level, 'is_postable' => $a->is_postable]])
                ->all();
            $parents = [];

            foreach ($template as $entry) {
                if ($entry['parent_code'] !== null) {
                    $parents[$entry['parent_code']] = true;
                }
            }

            $pending = array_diff_key($template, $known);
            $created = 0;
            $skipped = count($template) - count($pending);

            // Parents first: each pass inserts the entries whose parent is already known.
            while ($pending !== []) {
                $rows = [];

                foreach ($pending as $code => $entry) {
                    $parentCode = $entry['parent_code'];

                    if ($parentCode !== null && ! isset($known[$parentCode])) {
                        continue;
                    }

                    unset($pending[$code]);
                    $parent = $parentCode === null ? null : $known[$parentCode];

                    if ($parent !== null && $parent['is_postable'] && ! $this->demote($parent['id'])) {
                        $skipped++;

                        continue;
                    }

                    if ($parent !== null) {
                        $known[$parentCode]['is_postable'] = false;
                    }

                    $id = (string) Str::uuid7();
                    $postable = $entry['postable'] && ! isset($parents[$code]);
                    $known[$code] = ['id' => $id, 'level' => ($parent['level'] ?? 0) + 1, 'is_postable' => $postable];
                    $rows[] = [
                        'id' => $id,
                        'company_id' => $company,
                        'code' => $code,
                        'name' => $entry['name'],
                        'parent_id' => $parent['id'] ?? null,
                        'level' => $known[$code]['level'],
                        'type' => $entry['type'],
                        'normal_balance' => $entry['normal_balance'],
                        'is_postable' => $postable,
                        'is_active' => true,
                        'is_system' => true,
                        'tdhp_group' => $entry['tdhp_group'],
                        'requires_party' => $entry['flags']['requires_party'],
                        'requires_cost_center' => $entry['flags']['requires_cost_center'],
                        'requires_project' => $entry['flags']['requires_project'],
                        'is_revaluable' => $entry['flags']['is_revaluable'],
                        'version' => 1,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }

                if ($rows === []) {
                    // Remaining entries reference parents that are neither in the template nor in the chart.
                    $invalid += count($pending);

                    break;
                }

                foreach (array_chunk($rows, 200) as $chunk) {
                    DB::table('accounts')->insert($chunk);
                }

                $created += count($rows);
            }

            return ['created' => $created, 'skipped' => $skipped, 'invalid' => $invalid, 'available' => true];
        });
    }

    /**
     * @return list<mixed>|null
     */
    private function load(?string $path): ?array
    {
        $configured = config('accounting.chart_path');
        $path ??= is_string($configured) ? $configured : '';

        if ($path === '' || ! is_file($path)) {
            return null;
        }

        $contents = file_get_contents($path);

        try {
            $data = json_decode($contents === false ? '' : $contents, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }

        return is_array($data) && array_is_list($data) ? $data : null;
    }

    private function demote(string $accountId): bool
    {
        if (ChartOfAccounts::used($accountId)) {
            return false;
        }

        DB::table('accounts')->where('id', $accountId)->update(['is_postable' => false, 'updated_at' => now()]);

        return true;
    }

    /**
     * @return array{code: string, name: string, parent_code: string|null, type: string, normal_balance: string, tdhp_group: int|null, postable: bool, scheme: string|null, flags: array{requires_party: bool, requires_cost_center: bool, requires_project: bool, is_revaluable: bool}}|null
     */
    private static function normalize(mixed $entry): ?array
    {
        if (! is_array($entry)) {
            return null;
        }

        $code = $entry['code'] ?? null;
        $name = $entry['name'] ?? null;
        $type = is_string($entry['type'] ?? null) ? AccountType::tryFrom($entry['type']) : null;
        $balance = is_string($entry['normal_balance'] ?? null) ? NormalBalance::tryFrom($entry['normal_balance']) : null;
        $parent = $entry['parent_code'] ?? null;
        $group = $entry['tdhp_group'] ?? null;
        $scheme = $entry['scheme'] ?? null;
        $flags = is_array($entry['flags'] ?? null) ? $entry['flags'] : [];

        if (! is_string($code) || $code === '' || strlen($code) > 32 || ! is_string($name) || $name === '' || $type === null || $balance === null
            || ($parent !== null && (! is_string($parent) || $parent === $code))
            || ($group !== null && (! is_int($group) || $group < 1 || $group > 9))
            || ($scheme !== null && ExpenseScheme::tryFrom(is_string($scheme) ? $scheme : '') === null)) {
            return null;
        }

        return [
            'code' => $code,
            'name' => mb_substr($name, 0, 200),
            'parent_code' => $parent,
            'type' => $type->value,
            'normal_balance' => $balance->value,
            'tdhp_group' => $group ?? ChartOfAccounts::groupOf($code),
            'postable' => ($entry['postable'] ?? true) === true,
            'scheme' => is_string($scheme) ? $scheme : null,
            'flags' => [
                'requires_party' => ($flags['requires_party'] ?? false) === true,
                'requires_cost_center' => ($flags['requires_cost_center'] ?? false) === true,
                'requires_project' => ($flags['requires_project'] ?? false) === true,
                'is_revaluable' => ($flags['is_revaluable'] ?? false) === true,
            ],
        ];
    }
}
