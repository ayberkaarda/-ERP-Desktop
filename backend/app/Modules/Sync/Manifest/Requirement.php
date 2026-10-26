<?php

declare(strict_types=1);

namespace App\Modules\Sync\Manifest;

/**
 * Manifest `requires` (common.schema.json#/$defs/requires): any_of = one is enough,
 * all_of = every one is needed; both given = both must hold.
 */
final readonly class Requirement
{
    /**
     * @param  list<string>  $anyOf
     * @param  list<string>  $allOf
     */
    public function __construct(
        public array $anyOf = [],
        public array $allOf = [],
    ) {}

    public static function fromArray(mixed $value): self
    {
        $value = is_array($value) ? $value : [];

        return new self(Manifest::strings($value['any_of'] ?? []), Manifest::strings($value['all_of'] ?? []));
    }

    /**
     * @param  array<string, true>  $granted  permission name => true
     */
    public function satisfiedBy(array $granted): bool
    {
        if ($this->anyOf === [] && $this->allOf === []) {
            return false;
        }

        foreach ($this->allOf as $permission) {
            if (! isset($granted[$permission])) {
                return false;
            }
        }

        if ($this->anyOf === []) {
            return true;
        }

        foreach ($this->anyOf as $permission) {
            if (isset($granted[$permission])) {
                return true;
            }
        }

        return false;
    }
}
