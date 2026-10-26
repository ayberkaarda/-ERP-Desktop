<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Modules\Parties\Database\factories\PartyContactFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * @property string $name
 * @property string|null $title
 * @property string|null $email
 * @property string|null $phone
 * @property bool $is_primary
 */
class PartyContact extends PartyChild
{
    /** @use HasFactory<PartyContactFactory> */
    use HasFactory;

    /** @var list<string> */
    protected $fillable = ['name', 'title', 'email', 'phone', 'is_primary'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_primary' => false];

    public static function fields(): array
    {
        return ['name', 'title', 'email', 'phone', 'is_primary'];
    }

    public static function defaultFlag(): string
    {
        return 'is_primary';
    }

    public function getMorphClass(): string
    {
        return 'party_contact';
    }

    protected static function newFactory(): PartyContactFactory
    {
        return PartyContactFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_primary' => 'boolean'];
    }
}
