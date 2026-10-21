<?php

declare(strict_types=1);

use App\Modules\Sales\Http\Controllers\CustomerController;
use App\Modules\Sales\Http\Controllers\DeliveryController;
use App\Modules\Sales\Http\Controllers\InvoiceController;
use App\Modules\Sales\Http\Controllers\OrderController;
use App\Modules\Sales\Http\Controllers\PreviewController;
use App\Modules\Sales\Http\Controllers\QuoteController;
use App\Modules\Sales\Http\Controllers\ReturnController;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Models\SalesReturn;
use Illuminate\Support\Facades\Route;

// Loaded under api/v1 with the `api` group by ModuleServiceProvider. Route defaults name the policy
// ability and document class checked by the form requests before validation, and the payload form.

Route::middleware(['auth:sanctum', 'password.changed', 'company'])->group(function (): void {
    $documents = [
        'sales-quotes' => [QuoteController::class, SalesQuote::class, 'quote'],
        'sales-orders' => [OrderController::class, SalesOrder::class, 'order'],
        'sales-deliveries' => [DeliveryController::class, SalesDelivery::class, 'delivery'],
        'sales-invoices' => [InvoiceController::class, SalesInvoice::class, 'invoice'],
        'sales-returns' => [ReturnController::class, SalesReturn::class, 'return'],
    ];

    foreach ($documents as $path => [$controller, $model, $form]) {
        Route::get($path, [$controller, 'index']);
        Route::get("{$path}/export", [$controller, 'export']);
        Route::get("{$path}/{id}", [$controller, 'show'])->whereUuid('id');
        Route::get("{$path}/{id}/print-model", [$controller, 'printModel'])->whereUuid('id');

        if ($form !== 'return') {
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

    foreach (['send', 'accept', 'reject', 'cancel', 'revise'] as $verb) {
        $action("sales-quotes/{id}/{$verb}", QuoteController::class, $verb, 'update', SalesQuote::class);
    }
    $action('sales-quotes/{id}/convert', QuoteController::class, 'convert', 'update', SalesQuote::class, 'quote_convert');

    $action('sales-orders/{id}/confirm', OrderController::class, 'confirm', 'approve', SalesOrder::class);
    $action('sales-orders/{id}/revise', OrderController::class, 'revise', 'approve', SalesOrder::class, 'order', partial: true);
    $action('sales-orders/{id}/cancel', OrderController::class, 'cancel', 'update', SalesOrder::class);
    $action('sales-orders/{id}/close', OrderController::class, 'close', 'approve', SalesOrder::class);
    $action('sales-orders/{id}/deliveries', OrderController::class, 'deliveries', 'create', SalesDelivery::class, 'delivery_from_order');
    $action('sales-orders/{id}/invoices', OrderController::class, 'invoices', 'create', SalesInvoice::class, 'invoice_from_order');

    $action('sales-deliveries/{id}/post', DeliveryController::class, 'post', 'post', SalesDelivery::class);
    $action('sales-deliveries/{id}/cancel', DeliveryController::class, 'cancel', 'view', SalesDelivery::class);
    $action('sales-deliveries/{id}/invoice', DeliveryController::class, 'invoice', 'create', SalesInvoice::class, 'invoice_from_delivery');

    $action('sales-invoices/{id}/issue', InvoiceController::class, 'issue', 'issue', SalesInvoice::class);
    $action('sales-invoices/{id}/reverse', InvoiceController::class, 'reverse', 'reverse', SalesInvoice::class);
    $action('sales-invoices/{id}/cancel', InvoiceController::class, 'cancel', 'update', SalesInvoice::class);
    $action('sales-invoices/{id}/returns', InvoiceController::class, 'returns', 'create', SalesReturn::class, 'return_from_invoice');

    $action('sales-returns/{id}/approve', ReturnController::class, 'approve', 'approve', SalesReturn::class);
    $action('sales-returns/{id}/receive', ReturnController::class, 'receive', 'receive', SalesReturn::class);
    $action('sales-returns/{id}/credit', ReturnController::class, 'credit', 'credit', SalesReturn::class);
    $action('sales-returns/{id}/cancel', ReturnController::class, 'cancel', 'update', SalesReturn::class);

    Route::post('sales-documents/preview-totals', PreviewController::class)
        ->defaults('ability', 'sales-preview')->defaults('model', 'preview')->defaults('form', 'preview');

    Route::get('customers/{id}/exposure', [CustomerController::class, 'exposure'])->whereUuid('id');
    Route::get('customers/{id}/sales-summary', [CustomerController::class, 'summary'])->whereUuid('id');
});
