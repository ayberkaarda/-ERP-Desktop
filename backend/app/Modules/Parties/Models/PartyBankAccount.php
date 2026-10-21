<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Modules\Parties\Database\factories\PartyBankAccountFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

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
