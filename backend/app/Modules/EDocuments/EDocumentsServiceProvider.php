<?php

declare(strict_types=1);

namespace App\Modules\EDocuments;

use App\Core\Company\Http\ResolveCompany;
use App\Core\Modules\ModuleServiceProvider;
use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Contracts\EDocumentProvider;
use App\Modules\EDocuments\Http\Middleware\AuthorizeEDocument;
use App\Modules\EDocuments\Http\Middleware\OperationIdempotency;
use App\Modules\EDocuments\Providers\SandboxProvider;
use App\Modules\EDocuments\Services\SourceGuard;
use App\Modules\EDocuments\Ubl\DocumentXmlService;
use App\Modules\Sales\Contracts\EDocumentSourceGuard;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Foundation\Http\Kernel;

final class EDocumentsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Contracts\AssistantTools::class, Assistant\Tools::class);
        $this->app->bind(DocumentXml::class, DocumentXmlService::class);
        $this->app->bind(EDocumentProvider::class, SandboxProvider::class);
        $this->app->bind(EDocumentSourceGuard::class, SourceGuard::class);
    }

    public function boot(): void
    {
        $this->bootModule();
        $this->callAfterResolving(HttpKernel::class, static function (HttpKernel $kernel): void {
            if ($kernel instanceof Kernel) {
                $kernel->addToMiddlewarePriorityAfter(ResolveCompany::class, AuthorizeEDocument::class);
                $kernel->addToMiddlewarePriorityAfter(AuthorizeEDocument::class, OperationIdempotency::class);
            }
        });
    }
}
