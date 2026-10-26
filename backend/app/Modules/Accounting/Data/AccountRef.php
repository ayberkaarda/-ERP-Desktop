<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Data;

final readonly class AccountRef
{
    public function __construct(
        public string $id,
        public string $code,
        public string $name,
        /** debit|credit when the rule fixes the side. */
        public ?string $side = null,
        public ?string $ruleId = null,
    ) {}
}
