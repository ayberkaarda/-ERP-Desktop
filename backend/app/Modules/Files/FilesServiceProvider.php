<?php

declare(strict_types=1);

namespace App\Modules\Files;

use App\Core\Company\CompanyContext;
use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Files\Console\PruneOrphanBlobs;
use App\Modules\Files\Contracts\FileScanner;
use App\Modules\Files\Models\File;
use App\Modules\Files\Policies\FilePolicy;
use App\Modules\Files\Services\FileService;
use App\Modules\Files\Services\NullFileScanner;
use Illuminate\Contracts\Filesystem\Factory as Filesystems;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Gate;

final class FilesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // A real scanner binding elsewhere wins over this default.
        $this->app->bindIf(FileScanner::class, NullFileScanner::class);

        $this->app->bind(FileService::class, static function (Application $app): FileService {
            $disk = config('filesystems.files_disk');
            $ttl = config('filesystems.files_url_ttl_minutes');

            return new FileService(
                $app->make(Filesystems::class),
                $app->make(FileScanner::class),
                $app->make(CompanyContext::class),
                is_string($disk) && $disk !== '' ? $disk : 'local',
                is_int($ttl) && $ttl > 0 ? $ttl : 5,
            );
        });
    }

    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([PruneOrphanBlobs::class]);
        }

        Gate::policy(File::class, FilePolicy::class);
    }
}
