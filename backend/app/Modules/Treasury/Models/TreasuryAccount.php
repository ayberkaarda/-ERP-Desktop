<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

class TreasuryAccount extends TreasuryRecord
{
    protected $table = 'treasury_accounts';

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'allow_negative' => 'boolean'];
    }

    public function beforeActivityLogged(Model $activity, string $event): void
    {
        $changes = $activity->getAttribute('attribute_changes');
        if (! $changes instanceof Collection) {
            return;
        }
        foreach (['attributes', 'old'] as $key) {
            $set = $changes->get($key);
            if (is_array($set) && is_string($set['iban'] ?? null) && $set['iban'] !== '') {
                $set['iban'] = substr($set['iban'], 0, 2).'?'.substr($set['iban'], -4);
                $changes->put($key, $set);
            }
        }$activity->setAttribute('attribute_changes', $changes);
    }
}
