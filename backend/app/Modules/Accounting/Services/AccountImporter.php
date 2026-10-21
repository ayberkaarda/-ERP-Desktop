<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\NormalBalance;
use App\Modules\Accounting\Support\Messages;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Maatwebsite\Excel\Facades\Excel;
use Throwable;

/**
 * CSV/XLSX import of accounts (one per row, parents before or anywhere above their children).
 * Every row runs through the same service as the API inside a savepoint; a dry run, or a run with
 * any error, rolls everything back. Existing codes are reported, never overwritten.
 */
final class AccountImporter
{
    public const array COLUMNS = [
        'code', 'name', 'parent_code', 'type', 'normal_balance', 'is_postable', 'currency_code', 'tdhp_group',
        'requires_party', 'requires_cost_center', 'requires_project', 'is_revaluable', 'notes',
    ];

    private const array BOOLEANS = ['is_postable', 'requires_party', 'requires_cost_center', 'requires_project', 'is_revaluable'];

    public function __construct(private readonly ChartOfAccounts $chart) {}

    /**
     * @return array{dry_run: bool, total: int, created: int, errors: list<array{row: int, field: string, message: string}>}
     */
    public function import(UploadedFile $file, bool $dryRun): array
    {
        $rows = $this->read($file);
        $max = config('accounting.import_max_rows');
        $max = is_numeric($max) ? (int) $max : 5000;

        if (count($rows) > $max) {
            Messages::fail('file', 'import_too_large', ['max' => $max]);
        }

        $errors = [];
        $created = 0;
        DB::beginTransaction();

        try {
            foreach ($rows as $number => $row) {
                $data = $this->validated($row, $number, $errors);

                if ($data === null) {
                    continue;
                }

                try {
                    $this->chart->create($data);
                    $created++;
                } catch (ValidationException $e) {
                    foreach ($e->errors() as $field => $messages) {
                        $errors[] = ['row' => $number, 'field' => $field, 'message' => (string) ($messages[0] ?? '')];
                    }
                } catch (ApiException $e) {
                    $errors[] = ['row' => $number, 'field' => 'code', 'message' => $e->getMessage()];
                }
            }
        } catch (Throwable $e) {
            DB::rollBack();

            throw $e;
        }

        if ($dryRun || $errors !== []) {
            DB::rollBack();
        } else {
            DB::commit();
        }

        $report = ['dry_run' => $dryRun, 'total' => count($rows), 'created' => $dryRun || $errors !== [] ? 0 : $created, 'errors' => $errors];

        if (! $dryRun && $errors !== []) {
            $fields = [];

            foreach ($errors as $error) {
                $fields["rows.{$error['row']}.{$error['field']}"][] = $error['message'];
            }

            throw new ApiException(ErrorCode::ValidationError, Messages::get('import_failed', ['count' => count($errors)]), $fields);
        }

        return $report;
    }

    /**
     * @param  array<string, string|null>  $row
     * @param  list<array{row: int, field: string, message: string}>  $errors
     * @return array<string, mixed>|null
     */
    private function validated(array $row, int $number, array &$errors): ?array
    {
        $validator = Validator::make($row, [
            'code' => ['required', 'string', 'max:32', 'regex:/^\S+$/'],
            'name' => ['required', 'string', 'max:200'],
            'parent_code' => ['nullable', 'string', 'max:32'],
            'type' => ['nullable', Rule::enum(AccountType::class)],
            'normal_balance' => ['nullable', Rule::enum(NormalBalance::class)],
            'currency_code' => ['nullable', 'string', 'size:3'],
            'tdhp_group' => ['nullable', 'integer', 'between:1,9'],
            'notes' => ['nullable', 'string', 'max:2000'],
            ...array_fill_keys(self::BOOLEANS, ['nullable', 'in:0,1,true,false,yes,no,evet,hayir,hayır']),
        ]);

        if ($validator->fails()) {
            foreach ($validator->errors()->messages() as $field => $messages) {
                $errors[] = ['row' => $number, 'field' => $field, 'message' => (string) ($messages[0] ?? '')];
            }

            return null;
        }

        $data = [];

        foreach ($row as $column => $value) {
            if ($value === null || $value === '') {
                continue;
            }

            $data[$column] = match (true) {
                in_array($column, self::BOOLEANS, true) => in_array(mb_strtolower($value), ['1', 'true', 'yes', 'evet'], true),
                $column === 'tdhp_group' => (int) $value,
                $column === 'currency_code' => strtoupper($value),
                default => $value,
            };
        }

        return $data;
    }

    /**
     * Rows keyed by their line number in the file (header = line 1), values keyed by column.
     *
     * @return array<int, array<string, string|null>>
     */
    private function read(UploadedFile $file): array
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $raw = $extension === 'xlsx' ? $this->xlsx($file) : $this->csv($file);

        if ($raw === []) {
            Messages::fail('file', 'import_empty');
        }

        $header = array_map(static fn (mixed $h): string => strtolower(trim(is_scalar($h) ? (string) $h : '', " \t\n\r\0\x0B\u{FEFF}")), array_shift($raw));

        if (! in_array('code', $header, true) || ! in_array('name', $header, true)) {
            Messages::fail('file', 'import_header');
        }

        $rows = [];

        foreach ($raw as $index => $values) {
            $row = [];

            foreach ($header as $position => $column) {
                if (in_array($column, self::COLUMNS, true)) {
                    $value = $values[$position] ?? null;
                    $row[$column] = $value === null || $value === '' ? null : trim(is_scalar($value) ? (string) $value : '');
                }
            }

            if (array_filter($row, static fn (?string $v): bool => $v !== null && $v !== '') !== []) {
                $rows[$index + 2] = $row;
            }
        }

        return $rows;
    }

    /**
     * @return list<list<mixed>>
     */
    private function csv(UploadedFile $file): array
    {
        $handle = fopen($file->getRealPath(), 'rb');

        if ($handle === false) {
            Messages::fail('file', 'import_empty');
        }

        $first = (string) fgets($handle);
        $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
        rewind($handle);
        $rows = [];

        while (($line = fgetcsv($handle, null, $delimiter, '"', '')) !== false) {
            $rows[] = $line;
        }

        fclose($handle);

        return $rows;
    }

    /**
     * @return list<list<mixed>>
     */
    private function xlsx(UploadedFile $file): array
    {
        $sheets = Excel::toArray(new AccountImportSheet, $file);
        $first = $sheets[0] ?? [];

        return array_values(array_map(static fn (array $r): array => array_values($r), $first));
    }
}
