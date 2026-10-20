<?php

declare(strict_types=1);

use App\Modules\Files\Models\File;
use App\Modules\Files\Services\FileService;
use App\Modules\Files\Services\OoxmlPackage;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\Svc\SvcActors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    SvcActors::install();
    Storage::fake('local');
    $this->company = SvcActors::company();
    $this->user = SvcActors::user(['files.view', 'files.create', 'files.delete']);
    $this->post = function (UploadedFile $file, string $key = 'k') {
        Auth::forgetGuards();

        return $this->actingAs($this->user, 'web')
            ->withHeaders(['X-Company-Id' => $this->company, 'Accept' => 'application/json', 'Idempotency-Key' => $key])
            ->post('/api/v1/files', ['file' => $file]);
    };
    $this->zip = function (string $name, array $entries): UploadedFile {
        $path = tempnam(sys_get_temp_dir(), 'ooxml');
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $content) {
            $zip->addFromString((string) $entry, $content);
        }
        $zip->close();

        return new UploadedFile($path, $name, null, null, true);
    };
});

it('fails with 500 and leaves nothing behind when the storage write fails', function (): void {
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('writeStream')->andReturn(false);
    $disk->shouldReceive('delete')->andReturn(true);
    Storage::set('local', $disk);

    ($this->post)(UploadedFile::fake()->createWithContent('a.txt', 'hello'), 'w1')
        ->assertStatus(500)->assertJsonPath('errors.code', 'SERVER_ERROR');
    SvcActors::activate($this->company);
    expect(File::query()->count())->toBe(0);

    // The failure is not stored as a replayable response.
    ($this->post)(UploadedFile::fake()->createWithContent('a.txt', 'hello'), 'w1')->assertStatus(500);
});

it('answers 413 for an upload PHP refused, before idempotency touches it', function (): void {
    $path = tempnam(sys_get_temp_dir(), 'big');
    $broken = new UploadedFile($path, 'big.pdf', null, UPLOAD_ERR_INI_SIZE, true);

    ($this->post)($broken, 'u1')->assertStatus(413)->assertJsonPath('errors.code', 'FILE_TOO_LARGE');

    $partial = new UploadedFile($path, 'part.pdf', null, UPLOAD_ERR_PARTIAL, true);
    ($this->post)($partial, 'u2')->assertStatus(422)->assertJsonStructure(['errors' => ['fields' => ['file']]]);
});

it('removes the blob when the surrounding transaction rolls back', function (): void {
    SvcActors::activate($this->company);
    $service = app(FileService::class);

    try {
        DB::transaction(function () use ($service): void {
            $service->store(UploadedFile::fake()->createWithContent('a.txt', 'hello'), $this->user);
            expect(Storage::disk('local')->allFiles())->toHaveCount(1);

            throw new RuntimeException('late failure');
        });
    } catch (RuntimeException) {
    }

    expect(Storage::disk('local')->allFiles())->toBe([])
        ->and(File::query()->count())->toBe(0);
});

it('accepts a real OOXML package and rejects look-alikes', function (): void {
    $docx = ($this->zip)('ok.docx', ['[Content_Types].xml' => '<Types/>', 'word/document.xml' => '<w:document/>']);
    ($this->post)($docx, 'o1')->assertCreated()
        ->assertJsonPath('data.mime', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    $plain = ($this->zip)('fake.docx', ['readme.txt' => 'not an office file']);
    ($this->post)($plain, 'o2')->assertStatus(422)->assertJsonPath('errors.code', 'UNSUPPORTED_FILE_TYPE');

    $wrongType = ($this->zip)('sheet.xlsx', ['[Content_Types].xml' => '<Types/>', 'word/document.xml' => '<w:document/>']);
    ($this->post)($wrongType, 'o3')->assertStatus(422);
});

it('rejects archive bombs and traversal entries', function (): void {
    $base = ['[Content_Types].xml' => '<Types/>', 'word/document.xml' => '<w:document/>'];

    $ratio = ($this->zip)('ratio.docx', $base + ['word/big.xml' => str_repeat('0', 5 * 1024 * 1024)]);
    expect(OoxmlPackage::isValid((string) $ratio->getRealPath(), 'docx'))->toBeFalse();

    $many = $base;
    for ($i = 0; $i <= OoxmlPackage::MAX_ENTRIES; $i++) {
        $many["word/p{$i}.xml"] = (string) $i;
    }
    expect(OoxmlPackage::isValid((string) ($this->zip)('many.docx', $many)->getRealPath(), 'docx'))->toBeFalse();

    $traversal = ($this->zip)('trav.docx', $base + ['../evil.xml' => 'x']);
    expect(OoxmlPackage::isValid((string) $traversal->getRealPath(), 'docx'))->toBeFalse();

    $good = ($this->zip)('good.docx', $base);
    expect(OoxmlPackage::isValid((string) $good->getRealPath(), 'docx'))->toBeTrue();
});

it('prunes only old blobs without metadata, dry run by default', function (): void {
    $disk = Storage::disk('local');
    $disk->put('companies/c1/2026/01/orphan.txt', 'x');
    $disk->put('companies/c1/2026/01/fresh.txt', 'x');
    $disk->put('companies/c1/2026/01/known.txt', 'x');
    $old = now()->subDays(3)->getTimestamp();
    touch($disk->path('companies/c1/2026/01/orphan.txt'), $old);
    touch($disk->path('companies/c1/2026/01/known.txt'), $old);
    DB::table('files')->insert([
        'company_id' => $this->company, 'disk' => 'local', 'path' => 'companies/c1/2026/01/known.txt',
        'original_name' => 'k.txt', 'mime' => 'text/plain', 'size' => 1, 'sha256' => str_repeat('a', 64),
        'created_at' => now(), 'updated_at' => now(), 'deleted_at' => now(),
    ]);
    config(['filesystems.files_disk' => 'local']);

    Artisan::call('files:prune-orphans');
    expect($disk->exists('companies/c1/2026/01/orphan.txt'))->toBeTrue();

    Artisan::call('files:prune-orphans', ['--force' => true]);
    expect($disk->exists('companies/c1/2026/01/orphan.txt'))->toBeFalse()
        ->and($disk->exists('companies/c1/2026/01/fresh.txt'))->toBeTrue()
        ->and($disk->exists('companies/c1/2026/01/known.txt'))->toBeTrue();
});
