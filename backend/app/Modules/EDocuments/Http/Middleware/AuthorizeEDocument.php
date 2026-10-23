<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Http\Middleware;

use App\Models\User;
use App\Modules\EDocuments\Enums\DocumentKind;
use App\Modules\EDocuments\Models\Document;
use App\Modules\EDocuments\Services\Access;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthorizeEDocument
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $action = (string) $request->route()?->getActionMethod();
        $permission = match ($action) {
            'store','update','cancel' => 'edocuments.create','validateDocument' => 'edocuments.validate','send','retry','poll' => 'edocuments.send','respond' => 'edocuments.respond','import','pollInbox','linkPurchase' => 'edocuments.import','stageInbox','setOutcome','saveTaxpayer' => 'edocuments.manage',default => 'edocuments.view'
        };
        app(Access::class)->authorize($user, $permission);
        $id = $request->route('id');
        $document = is_string($id) ? Document::query()->findOrFail($id) : null;
        app(Access::class)->authorize($user, $permission, $document);
        if ($action === 'linkPurchase') {
            app(Access::class)->authorize($user, 'purchasing.invoices.view', $document);
        }
        if (in_array($action, ['store', 'sources'], true)) {
            $value = $request->input('kind', 'e_invoice');
            $kind = is_string($value) ? DocumentKind::tryFrom($value) : null;
            if ($kind !== null) {
                app(Access::class)->source($user, $kind);
            }
        }

        return $next($request);
    }
}
