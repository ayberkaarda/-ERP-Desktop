<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use App\Core\Documents\VersionConflictException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\WriteOutcome;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * Write adapter for `fixture-notes`: create/update/delete and the `close` action.
 *
 * Real adapters replay their module's FormRequest, Policy and Service; this one keeps the same
 * contract with inline rules so the Sync module can be tested before any module adapter exists.
 * Payload `title` = "reject" is refused (VALIDATION_ERROR) to exercise the rejected path.
 */
final class FixtureNoteSyncWriter implements SyncWriter
{
    public function resource(): string
    {
        return FixtureNoteSyncResource::NAME;
    }

    public function find(string $id): ?Model
    {
        return FixtureNote::query()->find($id);
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof FixtureNote ? $target->currentVersion() : 0;
    }

    public function isDraft(Model $target): bool
    {
        return $target instanceof FixtureNote && $target->isDraft();
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        foreach ($constraints as $field => $value) {
            if ($target->getAttribute($field) !== $value) {
                return false;
            }
        }

        return true;
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        $errors = $this->validate($mutation->payload, creating: true);

        if ($errors !== null) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $errors);
        }

        $note = FixtureNote::query()->create([
            'id' => $mutation->id,
            'title' => $mutation->payload['title'],
            'status' => 'draft',
        ]);
        $this->replaceLines($note, $mutation->payload);

        return $this->applied($note);
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        assert($target instanceof FixtureNote);
        $errors = $this->validate($mutation->payload, creating: false);

        if ($errors !== null) {
            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $errors);
        }

        try {
            $target->assertVersion($version);

            if (array_key_exists('title', $mutation->payload)) {
                $target->title = (string) $mutation->payload['title'];
            }

            $target->save();
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        }

        $this->replaceLines($target, $mutation->payload);

        return $this->applied($target);
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        assert($target instanceof FixtureNote);

        if ($target->currentVersion() !== $version) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        }

        $target->delete();

        return WriteOutcome::deleted();
    }

    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        assert($target instanceof FixtureNote);

        if ($mutation->action !== 'close') {
            return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
        }

        try {
            $target->assertVersion($version);
            $target->status = 'closed';
            $target->save();
        } catch (VersionConflictException) {
            return WriteOutcome::rejected(ErrorCode::VersionConflict);
        }

        return $this->applied($target);
    }

    public function lockedFields(): array
    {
        return ['status'];
    }

    public function auditFields(): array
    {
        return ['title', 'status', 'version'];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, list<string>>|null
     */
    private function validate(array $payload, bool $creating): ?array
    {
        $validator = Validator::make($payload, [
            'title' => [$creating ? 'required' : 'sometimes', 'string', 'max:100', 'not_in:reject'],
            'lines' => ['sometimes', 'array', 'max:500'],
            'lines.*.body' => ['required', 'string', 'max:200'],
        ]);

        /** @var array<string, list<string>> $messages */
        $messages = $validator->errors()->toArray();

        return $validator->fails() ? $messages : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function replaceLines(FixtureNote $note, array $payload): void
    {
        if (! is_array($payload['lines'] ?? null)) {
            return;
        }

        $note->lines()->delete();

        foreach (array_values($payload['lines']) as $i => $line) {
            $note->lines()->create(['position' => $i + 1, 'body' => is_array($line) ? (string) ($line['body'] ?? '') : '']);
        }
    }

    private function applied(FixtureNote $note): WriteOutcome
    {
        $note->load('lines');
        /** @var array<string, mixed> $data */
        $data = (new FixtureNoteResource($note))->toArray(new Request);

        return WriteOutcome::applied($note->currentVersion(), $data);
    }
}
