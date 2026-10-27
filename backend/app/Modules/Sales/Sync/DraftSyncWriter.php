<?php

declare(strict_types=1);

namespace App\Modules\Sales\Sync;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\TargetConstraints;
use App\Core\Sync\WriteOutcome;
use App\Models\User;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Policies\SalesPolicy;
use App\Modules\Sales\Services\OrderService;
use App\Modules\Sales\Services\QuoteService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Offline draft writes of sales-quotes and sales-orders (create, update, delete). Each mutation
 * replays the REST chain: a synthetic request matched against the module's own route (so the
 * route defaults `ability`, `model`, `form` are the REST ones), DocumentRequest authorization and
 * rules, the record-level policy check of the controller, then QuoteService / OrderService.
 * Failures come back as outcomes: validation → VALIDATION_ERROR with fields, policy → FORBIDDEN,
 * a document that left draft → DOCUMENT_LOCKED conflict, a stale version → VERSION_CONFLICT.
 *
 * What a write also changes is decided by the services, not here: the manifest's
 * write.derived_fields must list it (party snapshot, fx_rate, due_date, totals; the tax rate of
 * every line is looked up again at the document date, see DocumentComposer::tax).
 */
final class DraftSyncWriter implements SyncWriter
{
    /** Manifest resource name => document class. */
    public const array RESOURCES = [
        'sales-quotes' => SalesQuote::class,
        'sales-orders' => SalesOrder::class,
    ];

    /**
     * @param  class-string<SalesQuote>|class-string<SalesOrder>  $model
     */
    public function __construct(private readonly string $name, private readonly string $model)
    {
        if (! in_array($model, self::RESOURCES, true)) {
            throw new InvalidArgumentException("{$model} has no offline draft writes.");
        }
    }

    public static function for(string $name): self
    {
        return new self($name, self::RESOURCES[$name]);
    }

    public function resource(): string
    {
        return $this->name;
    }

    public function find(string $id): ?Model
    {
        return Str::isUuid($id) ? $this->model::query()->find($id) : null;
    }

    public function currentVersion(Model $target): int
    {
        return $target instanceof SalesDocument ? $target->currentVersion() : 0;
    }

    public function isDraft(Model $target): bool
    {
        return $target instanceof SalesDocument && $target->currentStatus() === 'draft';
    }

    public function targetSatisfies(Model $target, array $constraints): bool
    {
        return TargetConstraints::satisfiedBy($target, $constraints);
    }

    public function create(Authenticatable $user, Mutation $mutation): WriteOutcome
    {
        return $this->guarded($mutation, null, function () use ($user, $mutation): WriteOutcome {
            $request = $this->formRequest($user, 'POST', '', [...$this->payload($mutation), 'id' => $mutation->id]);
            $doc = $this->isQuote()
                ? app(QuoteService::class)->create($request->headerData(), $request->lineData() ?? [], $user, $this->canOverridePrice($user))
                : app(OrderService::class)->create($request->headerData(), $request->lineData() ?? [], $user, $this->canOverridePrice($user));

            return $this->applied($doc);
        });
    }

    public function update(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        $doc = $this->document($target);

        return $this->guarded($mutation, $doc, function () use ($user, $mutation, $doc, $version): WriteOutcome {
            $request = $this->formRequest($user, 'PATCH', '/'.$doc->id, [...$this->payload($mutation), 'version' => $version]);
            Gate::forUser($user)->authorize('update', $doc);
            $header = $request->headerData();
            $lines = $request->lineData();
            $saved = $doc instanceof SalesQuote
                ? app(QuoteService::class)->update($doc, $header, $lines, $version, $user, $this->canOverridePrice($user))
                : app(OrderService::class)->update($this->order($doc), $header, $lines, $version, $user, $this->canOverridePrice($user));

            return $this->applied($saved);
        });
    }

    public function delete(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        $doc = $this->document($target);

        return $this->guarded($mutation, $doc, function () use ($user, $doc, $version): WriteOutcome {
            $gate = Gate::forUser($user);
            $gate->authorize('delete', $this->model);
            $gate->authorize('delete', $doc);

            if ($doc instanceof SalesQuote) {
                app(QuoteService::class)->delete($doc, $version);
            } else {
                app(OrderService::class)->delete($this->order($doc), $version);
            }

            return WriteOutcome::deleted();
        });
    }

    /** No offline actions: send, accept, confirm and the rest are online only (manifest online_only). */
    public function action(Authenticatable $user, Mutation $mutation, Model $target, int $version): WriteOutcome
    {
        return WriteOutcome::rejected(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    public function lockedFields(): array
    {
        return ['status', 'number'];
    }

    /** The activity log attributes of the document (SalesDocument::getActivitylogOptions). */
    public function auditFields(): array
    {
        /** @var list<string> */
        return array_values((new $this->model)->getActivitylogOptions()->logAttributes);
    }

    /**
     * Payload as the REST endpoint takes it: the client never sends version (the Sync module
     * passes it) nor, on an edit, the key.
     *
     * @return array<string, mixed>
     */
    private function payload(Mutation $mutation): array
    {
        $payload = $mutation->payload;
        unset($payload['version'], $payload['id']);

        return $payload;
    }

    /**
     * DocumentRequest resolved like the router does for the REST call: matched route (defaults
     * ability/model/form), authorization, then the rules.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws ValidationException|AuthorizationException
     */
    private function formRequest(Authenticatable $user, string $method, string $suffix, array $payload): DocumentRequest
    {
        $base = Request::create('/api/v1/'.$this->name.$suffix, $method, $payload, server: ['HTTP_ACCEPT' => 'application/json']);
        $route = app('router')->getRoutes()->match($base);
        $base->setRouteResolver(static fn () => $route);
        $base->setUserResolver(static fn () => $user);

        $request = DocumentRequest::createFrom($base);
        $request->setContainer(app())->setRedirector(app(Redirector::class));
        $request->setUserResolver(static fn () => $user);
        $request->setRouteResolver(static fn () => $route);
        $request->validateResolved();

        return $request;
    }

    /**
     * @param  callable(): WriteOutcome  $write
     */
    private function guarded(Mutation $mutation, ?SalesDocument $doc, callable $write): WriteOutcome
    {
        try {
            return $write();
        } catch (ValidationException $e) {
            /** @var array<string, list<string>> $fields */
            $fields = $e->errors();

            return WriteOutcome::rejected(ErrorCode::ValidationError, fields: $fields);
        } catch (AuthorizationException) {
            return WriteOutcome::rejected(ErrorCode::Forbidden);
        } catch (ModelNotFoundException) {
            return WriteOutcome::rejected(ErrorCode::NotFound);
        } catch (HttpException $e) {
            return WriteOutcome::rejected($e->getStatusCode() === 404 ? ErrorCode::NotFound : ErrorCode::Forbidden);
        } catch (ApiException $e) {
            if ($e->errorCode === ErrorCode::DocumentLocked && $doc !== null) {
                $fresh = $doc->newQuery()->whereKey($doc->getKey())->firstOrFail();

                return WriteOutcome::conflict(SyncConflict::documentLocked($mutation->baseVersion, $fresh->currentVersion(), $this->data($fresh)));
            }

            return WriteOutcome::rejected($e->errorCode, $e->getMessage(), $e->fields);
        }
    }

    private function applied(SalesDocument $doc): WriteOutcome
    {
        $fresh = $doc->newQuery()->whereKey($doc->getKey())->firstOrFail();

        return WriteOutcome::applied($fresh->currentVersion(), $this->data($fresh));
    }

    /**
     * The pulled shape (DocumentSyncResource): list row with line_count, lines embedded.
     *
     * @return array<string, mixed>
     */
    private function data(SalesDocument $doc): array
    {
        $doc->loadCount('lines')->load('lines');

        /** @var array<string, mixed> */
        return (new DocumentResource($doc))->resolve(new Request);
    }

    private function canOverridePrice(Authenticatable $user): bool
    {
        return $user instanceof User && SalesPolicy::permits($user, 'sales.price_override');
    }

    private function isQuote(): bool
    {
        return $this->model === SalesQuote::class;
    }

    private function document(Model $target): SalesDocument
    {
        if (! $target instanceof $this->model) {
            throw new InvalidArgumentException('Target is not a '.$this->name.' document.');
        }

        return $target;
    }

    private function order(SalesDocument $doc): SalesOrder
    {
        assert($doc instanceof SalesOrder);

        return $doc;
    }
}
