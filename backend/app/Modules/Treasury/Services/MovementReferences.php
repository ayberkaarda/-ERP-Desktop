<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Core\Company\CompanyContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

final class MovementReferences
{
    /**
     * @param  list<stdClass>  $rows
     * @return list<stdClass>
     */
    public function annotate(array $rows): array
    {
        $company = app(CompanyContext::class)->id();
        $definitions = [['types' => ['treasury_payment', 'treasury_payment_reversal'], 'table' => 'treasury_payments', 'column' => 'number'], ['types' => ['treasury_transfer', 'treasury_transfer_reversal'], 'table' => 'treasury_transfers', 'column' => 'number'], ['types' => ['treasury_instrument', 'treasury_instrument_reversal'], 'table' => 'treasury_instruments', 'column' => 'number'], ['types' => ['treasury_opening'], 'table' => 'treasury_accounts', 'column' => 'code']];
        $references = [];
        foreach ($definitions as $definition) {
            $ids = [];
            foreach ($rows as $row) {
                if (in_array($row->source_type, $definition['types'], true)) {
                    $ids[] = (string) $row->source_id;
                }
            }if ($ids === [] || ! Schema::hasTable($definition['table'])) {
                continue;
            }$labels = DB::table($definition['table'])->where('company_id', $company)->whereIn('id', array_unique($ids))->pluck($definition['column'], 'id');
            foreach ($definition['types'] as $type) {
                foreach ($labels as $id => $label) {
                    if (is_string($label)) {
                        $references[$type.'|'.$id] = $label;
                    }
                }
            }
        }
        foreach ($rows as $row) {
            $row->reference = $references[$row->source_type.'|'.$row->source_id] ?? null;
        }

        return $rows;
    }
}
