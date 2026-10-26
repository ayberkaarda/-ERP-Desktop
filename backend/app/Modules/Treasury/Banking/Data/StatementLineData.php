<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Data;

final readonly class StatementLineData
{
    public function __construct(
        public string $date,
        public string $valueDate,
        public string $amount,
        public string $reference,
        public string $description,
    ) {}

    /** @return array<string, string> */
    public function toArray(): array
    {
        return ['date' => $this->date, 'value_date' => $this->valueDate, 'amount' => $this->amount,
            'reference' => $this->reference, 'description' => $this->description];
    }
}
