<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Models\User;
use App\Modules\Sales\Http\Requests\DocumentRequest;
use App\Modules\Sales\Policies\SalesPolicy;
use App\Modules\Sales\Services\Composer\ComposeOptions;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Support\Messages;
use Illuminate\Http\JsonResponse;

/**
 * POST /sales-documents/preview-totals: server-side pricing and totals for the editor, nothing is
 * stored. An explicit price the caller may not override comes back as a warning, not an error.
 */
final class PreviewController
{
    /** Any of these lets a user preview (someone who edits some sales document). */
    public const array PERMISSIONS = [
        'sales.quotes.create', 'sales.quotes.update', 'sales.orders.create', 'sales.orders.update', 'sales.deliveries.create',
        'sales.deliveries.update', 'sales.invoices.create', 'sales.invoices.update',
    ];

    public function __invoke(DocumentRequest $request, DocumentComposer $composer): JsonResponse
    {
        $user = $request->user();
        $lines = $request->lineData() ?? [];

        if ($lines === []) {
            Messages::fail('lines', 'lines_required');
        }

        $composed = $composer->compose($request->headerData(), $lines, new ComposeOptions(
            canOverridePrice: $user instanceof User && SalesPolicy::permits($user, 'sales.price_override'),
            strict: false,
        ));

        $header = $composed->header;
        $header['fx_rate'] = (string) $header['fx_rate'];

        return ApiResponse::success([
            'header' => $header,
            'lines' => array_map(static fn (array $line, ?array $pricing): array => [...$line, 'pricing' => $pricing], $composed->lines, $composed->pricing),
            'taxes' => array_map(static fn ($t): array => $t->toArray(), $composed->totals->taxes),
            'totals' => $composed->totals->headerAttributes(),
            'price_overrides' => $composed->priceOverrides,
        ], $composed->warnings === [] ? [] : ['warnings' => $composed->warnings]);
    }
}
