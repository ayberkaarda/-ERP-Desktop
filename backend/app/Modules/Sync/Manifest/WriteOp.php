<?php

declare(strict_types=1);

namespace App\Modules\Sync\Manifest;

use App\Core\Sync\MutationOp;

/**
 * One entry of a resource's `write.ops`.
 */
final readonly class WriteOp
{
    public function __construct(
        public MutationOp $op,
        public ?string $action,
        public string $route,
        public Requirement $requires,
        /** none | field-merge | exact */
        public string $versionCheck,
    ) {}

    /**
     * The manifest response's `writable` entry: create, update, delete or action:<name>.
     */
    public function key(): string
    {
        return $this->op === MutationOp::Action ? 'action:'.$this->action : $this->op->value;
    }

    public function isFieldMerge(): bool
    {
        return $this->versionCheck === 'field-merge';
    }
}
