<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Data;

final readonly class ItemData
{
    public function __construct(
        public string $id,
        public string $code,
        public string $name,
        public string $type,
        public string $baseUnitId,
        public ?string $categoryId,
        public ?string $defaultTaxCodeId,
        public ?string $purchaseTaxCodeId,
        public string $tracking,
        public bool $hasExpiry,
        public bool $isActive,
    ) {}

    /** @return array<string, string|bool|null> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'type' => $this->type,
            'base_unit_id' => $this->baseUnitId,
            'category_id' => $this->categoryId,
            'default_tax_code_id' => $this->defaultTaxCodeId,
            'purchase_tax_code_id' => $this->purchaseTaxCodeId,
            'tracking' => $this->tracking,
            'has_expiry' => $this->hasExpiry,
            'is_active' => $this->isActive,
        ];
    }
}
