<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Modules\Parties\Database\factories\PartyAddressFactory;
use App\Modules\Parties\Enums\AddressType;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * @property AddressType $type
 * @property string|null $label
 * @property string $line1
 * @property string|null $line2
 * @property string|null $district
 * @property string|null $city
 * @property string|null $postal_code
 * @property string $country
 * @property bool $is_default
 */
class PartyAddress extends PartyChild
{
    /** @use HasFactory<PartyAddressFactory> */
    use HasFactory;

    /** @var list<string> */
    protected $fillable = ['type', 'label', 'line1', 'line2', 'district', 'city', 'postal_code', 'country', 'is_default'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_default' => false];

    public static function fields(): array
    {
        return ['type', 'label', 'line1', 'line2', 'district', 'city', 'postal_code', 'country', 'is_default'];
    }

    public static function defaultFlag(): string
    {
        return 'is_default';
    }

    public static function defaultGroup(): array
    {
        return ['type'];
    }

    public function getMorphClass(): string
    {
        return 'party_address';
    }

    protected static function newFactory(): PartyAddressFactory
    {
        return PartyAddressFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['type' => AddressType::class, 'is_default' => 'boolean'];
    }
}
