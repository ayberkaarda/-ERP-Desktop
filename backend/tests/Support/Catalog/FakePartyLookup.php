<?php

declare(strict_types=1);

namespace Tests\Support\Catalog;

/** Stands in for the contract of a module that is not installed in this branch. */
interface FakePartyLookup
{
    public function find(string $id): mixed;
}
