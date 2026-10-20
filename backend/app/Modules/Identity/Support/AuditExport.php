<?php

declare(strict_types=1);

namespace App\Modules\Identity\Support;

use App\Modules\Identity\Models\Activity;
use Illuminate\Database\Eloquent\Builder;
use Maatwebsite\Excel\Concerns\FromQuery;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;

/**
 * XLSX export of audit entries; every cell goes through CsvFormulaGuard.
 *
 * @implements WithMapping<Activity>
 */
final class AuditExport implements FromQuery, WithHeadings, WithMapping
{
    /**
     * @param  Builder<Activity>  $query
     */
    public function __construct(private readonly Builder $query) {}

    /**
     * @return Builder<Activity>
     */
    public function query(): Builder
    {
        return $this->query;
    }

    /**
     * @return list<string>
     */
    public function headings(): array
    {
        return self::HEADINGS;
    }

    /**
     * @param  Activity  $row
     * @return list<string>
     */
    public function map($row): array
    {
        return self::row($row);
    }

    public const array HEADINGS = [
        'id', 'created_at', 'log_name', 'event', 'description', 'subject_type', 'subject_id',
        'causer_type', 'causer_id', 'old', 'attributes', 'ip',
    ];

    /**
     * @return list<string>
     */
    public static function row(Activity $activity): array
    {
        $changes = $activity->attribute_changes;
        $properties = $activity->properties;

        return CsvFormulaGuard::row([
            $activity->id,
            $activity->created_at?->toIso8601String(),
            $activity->log_name,
            $activity->event,
            $activity->description,
            $activity->subject_type,
            $activity->subject_id,
            $activity->causer_type,
            $activity->causer_id,
            $changes?->get('old'),
            $changes?->get('attributes'),
            $properties?->get('ip'),
        ]);
    }
}
