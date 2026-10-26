<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Models\User;
use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Services\AssistantAccess;
use App\Modules\Assistant\Services\ConversationService;
use App\Modules\Assistant\Services\TokenBudget;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

final readonly class AssistantController
{
    public function __construct(private AssistantAccess $access, private ConversationService $service) {}

    public function status(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $enabled = (bool) config('assistant.enabled');
        $usage = ['used_tokens' => 0, 'reserved_tokens' => 0, 'remaining_tokens' => max(0, (int) config('assistant.daily_tokens'))];
        if ($enabled) {
            $usage = app(TokenBudget::class)->status($user);
        }

        return ApiResponse::success([
            'enabled' => $enabled, 'configured' => $this->access->configured(),
            'can_use' => $this->access->allows($user, 'assistant.use'), 'can_admin' => $this->access->allows($user, 'assistant.usage.view'),
            'provider' => $enabled ? config('assistant.provider') : null, 'model' => $enabled ? config('assistant.model') : null,
            'limits' => ['max_input_chars' => (int) config('assistant.max_input_chars'), 'daily_tokens' => (int) config('assistant.daily_tokens')], 'usage' => $usage,
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $this->access->authorize($user);
        $rows = $this->service->owned($user)->orderByDesc('updated_at')->paginate(20);

        return ApiResponse::success($rows->getCollection()->map(fn (Conversation $c): array => $this->service->summary($c))->all(), ['pagination' => ['current_page' => $rows->currentPage(), 'per_page' => 20, 'total' => $rows->total(), 'last_page' => $rows->lastPage()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $this->access->authorize($user);
        $data = $request->validate(['title' => ['sometimes', 'string', 'max:200']]);

        return ApiResponse::created($this->service->summary($this->service->create($user, (string) ($data['title'] ?? __('assistant::messages.new_conversation')))));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $user = $this->user($request);
        $this->access->authorize($user);

        return ApiResponse::success($this->service->detail($this->service->find($user, $id)));
    }

    public function message(Request $request, string $id): StreamedResponse
    {
        $user = $this->user($request);
        $this->access->authorize($user);
        $data = $request->validate([
            'message' => ['required', 'string', 'max:'.(int) config('assistant.max_input_chars', 6000)],
            'request_id' => ['required', 'uuid'], 'context' => ['sometimes', 'array', 'max:5'],
            'context.*' => ['array:type,id,label'],
            'context.*.type' => ['required', Rule::in(['party', 'item', 'account', 'journal_entry', 'sales_quote', 'sales_order', 'sales_invoice', 'purchase_request', 'purchase_order', 'purchase_invoice', 'treasury_account'])],
            'context.*.id' => ['required', 'uuid'], 'context.*.label' => ['sometimes', 'string', 'max:120'],
        ]);
        // Context chips are unverified references for the user's convenience. Labels are neither
        // trusted nor sent to the provider, and record contents are available only through tools.
        $context = [];
        foreach ($data['context'] ?? [] as $chip) {
            $context[] = ['type' => (string) $chip['type'], 'id' => (string) $chip['id']];
        }
        $turn = $this->service->begin($user, $id, (string) $data['request_id'], (string) $data['message'], $context);
        $locale = app()->getLocale();

        return response()->stream(function () use ($turn, $user, $locale): void {
            ignore_user_abort(true);
            $previous = app()->getLocale();
            app()->setLocale($locale);
            try {
                $this->service->run($user, $turn, static function (string $event, array $payload): void {
                    echo 'event: '.$event."\n".'data: '.json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)."\n\n";
                    if (ob_get_level() > 0) {
                        @ob_flush();
                    }
                    flush();
                });
            } finally {
                app()->setLocale($previous);
            }
        }, 200, ['Content-Type' => 'text/event-stream', 'Cache-Control' => 'no-cache, no-store', 'X-Accel-Buffering' => 'no']);
    }

    public function decide(Request $request, string $id, string $callId): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', Rule::in(['approve', 'reject'])]]);
        $conversation = $this->service->decide($this->user($request), $id, $callId, $data['decision'] === 'approve');

        return ApiResponse::success($this->service->detail($conversation));
    }

    public function usage(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $this->access->authorize($user, 'assistant.usage.view');
        $data = $request->validate(['date_from' => ['sometimes', 'date_format:Y-m-d'], 'date_to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:date_from']]);
        $rows = DB::table('assistant_usage')->where('company_id', app(CompanyContext::class)->id())
            ->whereBetween('date', [$data['date_from'] ?? now('UTC')->subDays(30)->toDateString(), $data['date_to'] ?? now('UTC')->toDateString()])
            ->orderByDesc('date')->orderBy('user_id')->paginate(50, ['date', 'user_id', 'input_tokens', 'output_tokens', 'reserved_tokens', 'requests', 'failures']);

        return ApiResponse::success($rows->items(), ['pagination' => ['current_page' => $rows->currentPage(), 'per_page' => 50, 'total' => $rows->total(), 'last_page' => $rows->lastPage()]]);
    }

    private function user(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $user;
    }
}
