<?php

declare(strict_types=1);

namespace App\Modules\Files\Console;

use Illuminate\Console\Command;
use Illuminate\Contracts\Filesystem\Factory as Filesystems;
use Illuminate\Support\Facades\DB;

/**
 * Finds stored blobs with no files row (failed or rolled back uploads). Not scheduled.
 */
final class PruneOrphanBlobs extends Command
{
    protected $signature = 'files:prune-orphans {--disk= : Disk to scan (default: files disk)} {--hours=24 : Minimum blob age} {--force : Actually delete; without it only lists}';

    protected $description = 'List (or with --force remove) stored blobs that have no file record';

    public function handle(Filesystems $storage): int
    {
        $diskOption = $this->option('disk');
        $configured = config('filesystems.files_disk');
        $diskName = is_string($diskOption) && $diskOption !== '' ? $diskOption : (is_string($configured) ? $configured : 'local');
        $hours = max(1, (int) $this->option('hours'));
        $force = (bool) $this->option('force');
        $disk = $storage->disk($diskName);
        $cutoff = now()->subHours($hours)->getTimestamp();
        $found = 0;

        foreach (array_chunk($disk->allFiles('companies'), 500) as $chunk) {
            // Soft deleted rows still own their blob, so the table is read without scopes.
            $known = DB::table('files')->where('disk', $diskName)->whereIn('path', $chunk)->pluck('path')->all();

            foreach (array_diff($chunk, $known) as $path) {
                if ($disk->lastModified($path) > $cutoff) {
                    continue;
                }

                $found++;
                $this->line(($force ? 'removing ' : 'orphan ').$path);

                if ($force) {
                    $disk->delete($path);
                }
            }
        }

        $this->info($force ? "Removed {$found} orphan blob(s)." : "Dry run: {$found} orphan blob(s). Use --force to remove.");

        return self::SUCCESS;
    }
}
