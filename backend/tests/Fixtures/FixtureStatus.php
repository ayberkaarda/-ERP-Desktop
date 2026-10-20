<?php

declare(strict_types=1);

namespace Tests\Fixtures;

enum FixtureStatus: string
{
    case Draft = 'draft';
    case Submitted = 'submitted';
    case Approved = 'approved';
    case Posted = 'posted';
    case Cancelled = 'cancelled';
}
