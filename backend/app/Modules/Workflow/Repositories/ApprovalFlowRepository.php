<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Repositories;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Workflow\Models\ApprovalFlow;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

final class ApprovalFlowRepository
{
    /** @param array<string, mixed> $data */
    public function create(array $data): ApprovalFlow
    {
        return $this->persist(function () use ($data): ApprovalFlow {
            $flow = new ApprovalFlow;
            $flow->fill(collect($data)->except(['steps', 'version'])->all());
            $flow->save();
            $this->steps($flow, $data);

            return $flow->load('steps');
        });
    }

    /** @param array<string, mixed> $data */
    public function update(ApprovalFlow $flow, array $data): ApprovalFlow
    {
        return $this->persist(function () use ($flow, $data): ApprovalFlow {
            $locked = ApprovalFlow::query()->whereKey($flow->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion((int) $data['version']);
            $locked->fill(collect($data)->except(['steps', 'version'])->all());
            $locked->bumpVersion()->save();
            if (array_key_exists('steps', $data)) {
                $locked->steps()->delete();
                $this->steps($locked, $data);
            }

            return $locked->load('steps');
        });
    }

    public function delete(ApprovalFlow $flow, int $version): void
    {
        DB::transaction(function () use ($flow, $version): void {
            $locked = ApprovalFlow::query()->whereKey($flow->id)->lockForUpdate()->firstOrFail();
            $locked->assertVersion($version);
            $locked->delete();
        });
    }

    /** @param Closure(): ApprovalFlow $callback */
    private function persist(Closure $callback): ApprovalFlow
    {
        try {
            return DB::transaction($callback);
        } catch (UniqueConstraintViolationException $e) {
            if (! str_contains($e->getMessage(), 'approval_flows_active_type_unique')) {
                throw $e;
            }

            throw new ApiException(ErrorCode::ValidationError, __('workflow::messages.active_flow_exists'), previous: $e);
        }
    }

    /** @param array<string, mixed> $data */
    private function steps(ApprovalFlow $flow, array $data): void
    {
        /** @var list<array<string, mixed>> $steps */
        $steps = $data['steps'] ?? [];
        foreach ($steps as $step) {
            $flow->steps()->create($step);
        }
    }
}
