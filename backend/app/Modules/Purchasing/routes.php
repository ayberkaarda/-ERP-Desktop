<?php

declare(strict_types=1);

use App\Modules\Purchasing\Http\Controllers\InvoiceController;
use App\Modules\Purchasing\Http\Controllers\OrderController;
use App\Modules\Purchasing\Http\Controllers\PreviewController;
use App\Modules\Purchasing\Http\Controllers\ReceiptController;
use App\Modules\Purchasing\Http\Controllers\RequestController;
use App\Modules\Purchasing\Http\Controllers\ReturnController;
use App\Modules\Purchasing\Http\Controllers\RfqController;
use App\Modules\Purchasing\Http\Controllers\SupplierController;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Models\PurchaseRfq;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider. Route defaults name the policy
// ability and document class checked by the form requests before validation, and the payload form.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    $documents = [
        'purchase-requests' => [RequestController::class, PurchaseRequest::class, 'request', true],
        'purchase-rfqs' => [RfqController::class, PurchaseRfq::class, 'rfq', true],
        'purchase-orders' => [OrderController::class, PurchaseOrder::class, 'order', true],
        'purchase-receipts' => [ReceiptController::class, PurchaseReceipt::class, 'receipt', true],
        'purchase-invoices' => [InvoiceController::class, PurchaseInvoice::class, 'invoice', true],
        'purchase-returns' => [ReturnController::class, PurchaseReturn::class, 'return', false],
    ];

    foreach ($documents as $path => [$controller, $model, $form, $creatable]) {
        Route::get($path, [$controller, 'index']);
        Route::get("{$path}/export", [$controller, 'export']);
        Route::get("{$path}/{id}", [$controller, 'show'])->whereUuid('id');

        if (! in_array($form, ['request', 'rfq'], true)) {
            Route::get("{$path}/{id}/print-model", [$controller, 'printModel'])->whereUuid('id');
        }

        if ($creatable) {
            Route::post($path, [$controller, 'store'])->middleware('idempotent')
                ->defaults('ability', 'create')->defaults('model', $model)->defaults('form', $form);
        }

        Route::patch("{$path}/{id}", [$controller, 'update'])->whereUuid('id')
            ->defaults('ability', 'update')->defaults('model', $model)->defaults('form', $form);
        Route::delete("{$path}/{id}", [$controller, 'destroy'])->whereUuid('id');
    }

    $action = static function (string $path, string $controller, string $method, string $ability, string $model, ?string $form = null, bool $partial = false): void {
        $route = Route::post($path, [$controller, $method])->whereUuid('id')->middleware('idempotent')
            ->defaults('ability', $ability)->defaults('model', $model);

        if ($form !== null) {
            $route->defaults('form', $form)->defaults('partial', $partial);
        }
    };

    $action('purchase-requests/{id}/submit', RequestController::class, 'submit', 'update', PurchaseRequest::class);
    $action('purchase-requests/{id}/cancel', RequestController::class, 'cancel', 'update', PurchaseRequest::class);
    $action('purchase-requests/{id}/rfq', RequestController::class, 'rfq', 'create', PurchaseRfq::class, 'request_rfq');
    $action('purchase-requests/{id}/orders', RequestController::class, 'orders', 'create', PurchaseOrder::class, 'request_order');

    $action('purchase-rfqs/{id}/send', RfqController::class, 'send', 'update', PurchaseRfq::class);
    $action('purchase-rfqs/{id}/cancel', RfqController::class, 'cancel', 'update', PurchaseRfq::class);
    $action('purchase-rfqs/{id}/quotes', RfqController::class, 'quotes', 'update', PurchaseRfq::class, 'rfq_quote');
    $action('purchase-rfqs/{id}/award', RfqController::class, 'award', 'award', PurchaseRfq::class, 'rfq_award');
    Route::get('purchase-rfqs/{id}/comparison', [RfqController::class, 'comparison'])->whereUuid('id');

    $action('purchase-orders/{id}/submit', OrderController::class, 'submit', 'approve', PurchaseOrder::class);
    $action('purchase-orders/{id}/revise', OrderController::class, 'revise', 'approve', PurchaseOrder::class, 'order', partial: true);
    $action('purchase-orders/{id}/send', OrderController::class, 'send', 'update', PurchaseOrder::class);
    $action('purchase-orders/{id}/cancel', OrderController::class, 'cancel', 'update', PurchaseOrder::class);
    $action('purchase-orders/{id}/close', OrderController::class, 'close', 'approve', PurchaseOrder::class);
    $action('purchase-orders/{id}/receipts', OrderController::class, 'receipts', 'create', PurchaseReceipt::class, 'receipt_from_order');
    $action('purchase-orders/{id}/invoices', OrderController::class, 'invoices', 'create', PurchaseInvoice::class, 'invoice_from_order');

    $action('purchase-receipts/{id}/post', ReceiptController::class, 'post', 'post', PurchaseReceipt::class);
    $action('purchase-receipts/{id}/cancel', ReceiptController::class, 'cancel', 'cancel', PurchaseReceipt::class);
    $action('purchase-receipts/{id}/invoice', ReceiptController::class, 'invoice', 'create', PurchaseInvoice::class, 'invoice_from_receipt');
    $action('purchase-receipts/{id}/returns', ReceiptController::class, 'returns', 'create', PurchaseReturn::class, 'return_from_receipt');

    $action('purchase-invoices/{id}/book', InvoiceController::class, 'book', 'book', PurchaseInvoice::class);
    $action('purchase-invoices/{id}/reverse', InvoiceController::class, 'reverse', 'reverse', PurchaseInvoice::class);
    $action('purchase-invoices/{id}/cancel', InvoiceController::class, 'cancel', 'update', PurchaseInvoice::class);
    $action('purchase-invoices/{id}/returns', InvoiceController::class, 'returns', 'create', PurchaseReturn::class, 'return_from_invoice');
    Route::get('purchase-invoices/{id}/match', [InvoiceController::class, 'match'])->whereUuid('id');

    $action('purchase-returns/{id}/approve', ReturnController::class, 'approve', 'approve', PurchaseReturn::class);
    $action('purchase-returns/{id}/ship', ReturnController::class, 'ship', 'ship', PurchaseReturn::class);
    $action('purchase-returns/{id}/debit', ReturnController::class, 'debit', 'debit', PurchaseReturn::class);
    $action('purchase-returns/{id}/cancel', ReturnController::class, 'cancel', 'update', PurchaseReturn::class);

    Route::post('purchase-documents/preview-totals', PreviewController::class)
        ->defaults('ability', 'purchasing-preview')->defaults('model', 'preview')->defaults('form', 'preview');

    Route::get('suppliers/{id}/exposure', [SupplierController::class, 'exposure'])->whereUuid('id');
    Route::get('suppliers/{id}/purchase-summary', [SupplierController::class, 'summary'])->whereUuid('id');
    Route::get('suppliers/{id}/performance', [SupplierController::class, 'performance'])->whereUuid('id');
});
