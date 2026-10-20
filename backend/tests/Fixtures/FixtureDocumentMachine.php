<?php

declare(strict_types=1);

namespace Tests\Fixtures;

use App\Core\Documents\HasStatus;
use App\Core\Documents\StateMachine;
use Closure;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

final class FixtureDocumentMachine extends StateMachine
{
    /** @var list<string> */
    public array $calls = [];

    protected function transitions(): array
    {
        return [
            'draft' => ['submitted', 'cancelled'],
            'submitted' => ['approved', 'draft', 'cancelled'],
            'approved' => ['posted', 'cancelled'],
        ];
    }

    /** @var (Closure(Model&HasStatus): void)|null */
    public ?Closure $onBefore = null;

    protected function beforeTransition(Model&HasStatus $model, string $from, string $to, ?Authenticatable $actor): void
    {
        $this->calls[] = "before:{$from}>{$to}";

        if ($this->onBefore !== null) {
            ($this->onBefore)($model);
        }
    }

    protected function afterTransition(Model&HasStatus $model, string $from, string $to, ?Authenticatable $actor): void
    {
        $this->calls[] = "after:{$from}>{$to}";
    }
}
