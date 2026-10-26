<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Reports\Support;

final readonly class Table
{
    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>  $meta
     */
    public function __construct(public array $rows, public int $total, public array $meta = []) {}
}
