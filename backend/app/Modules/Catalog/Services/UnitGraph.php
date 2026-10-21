<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use Brick\Math\BigDecimal;
use Brick\Math\BigRational;
use InvalidArgumentException;

/**
 * Undirected conversion graph over units. Each edge says 1 from = factor to and is usable in
 * both directions (reverse = 1/factor). The graph is kept a forest, so any two connected units
 * have exactly one path and therefore exactly one factor: no cycle can contradict another path.
 * Arithmetic is exact (BigRational); rounding is left to the caller.
 */
final class UnitGraph
{
    /** @var array<string, array<string, BigRational>> */
    private array $adjacency = [];

    /**
     * @param  iterable<array{from: string, to: string, factor: string|BigDecimal}>  $edges
     */
    public function __construct(iterable $edges = [])
    {
        foreach ($edges as $edge) {
            $this->add($edge['from'], $edge['to'], $edge['factor']);
        }
    }

    public function add(string $from, string $to, string|BigDecimal $factor): void
    {
        $value = BigRational::of($factor);

        if ($from === $to || $value->isLessThanOrEqualTo(0)) {
            throw new InvalidArgumentException('A conversion needs two distinct units and a positive factor.');
        }

        if ($this->connected($from, $to)) {
            throw new InvalidArgumentException('The conversion would create a cycle.');
        }

        $this->adjacency[$from][$to] = $value;
        $this->adjacency[$to][$from] = $value->reciprocal();
    }

    public function connected(string $a, string $b): bool
    {
        return $this->factor($a, $b) !== null;
    }

    /** Adding this edge would close a cycle (the units are already convertible). */
    public function wouldCreateCycle(string $from, string $to): bool
    {
        return $from === $to || $this->connected($from, $to);
    }

    /**
     * 1 $from = factor $to, or null when no path exists.
     */
    public function factor(string $from, string $to): ?BigRational
    {
        if ($from === $to) {
            return BigRational::one();
        }

        /** @var array<string, BigRational> $reached */
        $reached = [$from => BigRational::one()];
        $queue = [$from];

        while ($queue !== []) {
            $unit = array_shift($queue);

            foreach ($this->adjacency[$unit] ?? [] as $next => $factor) {
                if (isset($reached[$next])) {
                    continue;
                }

                $reached[$next] = $reached[$unit]->multipliedBy($factor);

                if ($next === $to) {
                    return $reached[$next];
                }

                $queue[] = $next;
            }
        }

        return null;
    }

    /**
     * Checks a set of units with factors to one common unit (an item: base = 1, alternates = their
     * factor) against the graph: whenever two of them are connected, the graph factor between them
     * must equal the ratio of their factors exactly. Returns the first conflicting pair.
     *
     * @param  array<string, BigRational>  $factors
     * @return array{0: string, 1: string}|null
     */
    public function conflict(array $factors): ?array
    {
        ksort($factors);
        $references = [];

        foreach ($factors as $unit => $factor) {
            $unit = (string) $unit;

            foreach ($references as $reference) {
                $path = $this->factor($unit, $reference);

                if ($path === null) {
                    continue;
                }

                // 1 unit = path reference, so factor(unit) must be path * factor(reference).
                if (! $path->multipliedBy($factors[$reference])->isEqualTo($factor)) {
                    return [$reference, $unit];
                }

                continue 2;
            }

            // First unit seen in its component: it anchors the others (paths agree in a forest).
            $references[] = $unit;
        }

        return null;
    }

    /** @return list<string> units reachable from $unit, itself included */
    public function component(string $unit): array
    {
        $seen = [$unit => true];
        $queue = [$unit];

        while ($queue !== []) {
            $current = array_shift($queue);

            foreach (array_keys($this->adjacency[$current] ?? []) as $next) {
                if (! isset($seen[$next])) {
                    $seen[$next] = true;
                    $queue[] = $next;
                }
            }
        }

        return array_map('strval', array_keys($seen));
    }
}
