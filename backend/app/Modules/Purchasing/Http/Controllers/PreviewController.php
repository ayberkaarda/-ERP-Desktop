<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Models\User;
use App\Modules\Purchasing\Http\Requests\DocumentRequest;
use App\Modules\Purchasing\Policies\PurchasingPolicy;
use App\Modules\Purchasing\Services\Composer\ComposeOptions;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Support\Messages;
use Illuminate\Http\JsonResponse;

/**
 * POST /purchase-documents/preview-totals: server-side totals (tax, withholding, company currency)
 * for the editor, nothing is stored.
 */
final class PreviewController
{
    /** Any of these lets a user preview (someone who edits some purchasing document). */
    public const array PERMISSIONS = [
        'purchasing.orders.create', 'purchasing.orders.update', 'purchasing.receipts.create', 'purchasing.receipts.update',
        'purchasing.invoices.create', 'purchasing.invoices.update',
    ];

    public function __invoke(DocumentRequest $request, DocumentComposer $composer): JsonResponse
    {
        $user = $request->user();
        $lines = $request->lineData() ?? [];

        if ($lines === []) {
            Messages::fail('lines', 'lines_required');
        }

        $composed = $composer->compose($request->headerData(), $lines, new ComposeOptions(
            canOverridePrice: $user instanceof User && PurchasingPolicy::permits($user, 'purchasing.price_override'),
            strict: false,
        ));

        $header = $composed->header;
        $header['fx_rate'] = (string) $header['fx_rate'];

        return ApiResponse::success([
            'header' => $header,
            'lines' => $composed->lines,
            'taxes' => array_map(static fn ($t): array => $t->toArray(), $composed->totals->taxes),
            'totals' => $composed->totals->headerAttributes(),
        ], $composed->warnings === [] ? [] : ['warnings' => $composed->warnings]);
    }
}
