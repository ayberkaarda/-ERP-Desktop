<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Support;

use App\Modules\Purchasing\Support\Export;
use Illuminate\Database\Query\Builder;

/**
 * The rows a request wants: a page (offset, limit) of the JSON response, or every row of an export
 * up to a cap (refused with 422 as soon as the row count is known to exceed it, before rows are read).
 */
final readonly class Window
{
    public function __construct(
        public int $offset = 0,
        public ?int $limit = null,
        public ?int $cap = null,
    ) {}

    public static function page(int $page, int $perPage): self
    {
        return new self(($page - 1) * $perPage, $perPage);
    }

    public static function export(int $cap): self
    {
        return new self(0, null, $cap);
    }

    /** Refuses an export whose rows exceed the cap. */
    public function check(int $rows): void
    {
        if ($this->cap !== null) {
            Export::assertWithinCap($rows);
        }
    }

    /** Applies the window to an ordered query. */
    public function apply(Builder $query): Builder
    {
        $query->offset($this->offset);
        $limit = $this->limit ?? ($this->cap === null ? null : $this->cap + 1);

        return $limit === null ? $query : $query->limit($limit);
    }

    /**
     * The window of rows computed in memory (reports whose rows are aggregates).
     *
     * @template T
     *
     * @param  list<T>  $rows
     * @return list<T>
     */
    public function slice(array $rows): array
    {
        $this->check(count($rows));

        return array_slice($rows, $this->offset, $this->limit);
    }
}
