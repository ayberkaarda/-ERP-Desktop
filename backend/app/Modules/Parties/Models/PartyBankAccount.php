<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Modules\Parties\Database\factories\PartyBankAccountFactory;
use App\Modules\Parties\Validation\Iban;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

/**
 * @property string $bank_name
 * @property string $iban
 * @property string|null $swift
 * @property string|null $currency_code
 * @property bool $is_default
 */
class PartyBankAccount extends PartyChild
{
    /** @use HasFactory<PartyBankAccountFactory> */
    use HasFactory;

    /** @var list<string> */
    protected $fillable = ['bank_name', 'iban', 'swift', 'currency_code', 'is_default'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_default' => false];

    public static function fields(): array
    {
        return ['bank_name', 'iban', 'swift', 'currency_code', 'is_default'];
    }

    public static function defaultFlag(): string
    {
        return 'is_default';
    }

    /**
     * The audit trail is readable with audit.view alone, so it never carries a full IBAN.
     */
    public function beforeActivityLogged(Model $activity, string $event): void
    {
        $changes = $activity->getAttribute('attribute_changes');

        if (! $changes instanceof Collection) {
            return;
        }

        foreach (['attributes', 'old'] as $key) {
            $set = $changes->get($key);

            if (is_array($set) && is_string($set['iban'] ?? null)) {
                $set['iban'] = Iban::mask($set['iban']);
                $changes->put($key, $set);
            }
        }

        $activity->setAttribute('attribute_changes', $changes);
    }

    public function getMorphClass(): string
    {
        return 'party_bank_account';
    }

    protected static function newFactory(): PartyBankAccountFactory
    {
        return PartyBankAccountFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_default' => 'boolean'];
    }
}
