<?php

declare(strict_types=1);

use App\Modules\Files\Contracts\FileScanner;
use App\Modules\Files\Data\ScanResult;
use App\Modules\Files\Models\File;
use App\Modules\Files\Services\FileNameSanitizer;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Fixtures\Svc\AttachableDoc;
use Tests\Support\Svc\SvcActors;

uses(RefreshDatabase::class);

const PNG_BYTES = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82";

beforeEach(function (): void {
    SvcActors::install();
    Storage::fake('local');
    $this->company = SvcActors::company();
    $this->user = SvcActors::user(['files.view', 'files.create', 'files.delete']);
    $this->n = 0;

    $this->api = fn ($user = null, ?string $company = null) => tap($this, fn () => Auth::forgetGuards())
        ->actingAs($user ?? $this->user, 'web')
        ->withHeaders(['X-Company-Id' => $company ?? $this->company, 'Accept' => 'application/json']);

    $this->upload = function (UploadedFile $file, array $extra = [], $user = null, ?string $company = null) {
        $this->n++;

        return ($this->api)($user, $company)
            ->withHeader('Idempotency-Key', 'k-'.$this->n.'-'.Str::random(6))
            ->post('/api/v1/files', ['file' => $file, ...$extra]);
    };

    $this->png = fn (string $name = 'logo.png') => UploadedFile::fake()->createWithContent($name, PNG_BYTES);
});

it('uploads a file with a random per-company key and a hash', function (): void {
    $res = ($this->upload)(($this->png)('My Logo.png'))->assertCreated();

    $res->assertJsonPath('data.original_name', 'My Logo.png')
        ->assertJsonPath('data.mime', 'image/png')
        ->assertJsonPath('data.size', strlen(PNG_BYTES))
        ->assertJsonPath('data.sha256', hash('sha256', PNG_BYTES))
        ->assertJsonMissingPath('data.path')
        ->assertJsonMissingPath('data.disk');

    $file = File::query()->findOrFail($res->json('data.id'));
    expect($file->path)->toMatch('#^companies/'.$this->company.'/\d{4}/\d{2}/[0-9a-f-]{36}\.png$#')
        ->and($file->uploaded_by)->toBe($this->user->id)
        ->and($file->company_id)->toBe($this->company);
    Storage::disk('local')->assertExists($file->path);
});

it('never lets the client name influence the storage path', function (): void {
    $res = ($this->upload)(UploadedFile::fake()->createWithContent('..\\..\\etc/pass wd.png', PNG_BYTES))->assertCreated();

    $file = File::query()->findOrFail($res->json('data.id'));
    expect($file->original_name)->toBe('pass wd.png')
        ->and($file->path)->not->toContain('pass')
        ->and($file->path)->not->toContain('..');
});

it('sanitizes display names', function (): void {
    expect(FileNameSanitizer::clean('a/b\\c<d>.pdf'))->toBe('c_d_.pdf')
        ->and(FileNameSanitizer::clean("inv\u{202E}fdp.exe"))->toBe('invfdp.exe')
        ->and(FileNameSanitizer::clean('..'))->toBe('file')
        ->and(FileNameSanitizer::clean(str_repeat('a', 400).'.pdf'))->toHaveLength(150)
        ->and(FileNameSanitizer::clean("bad\x00name\xff.txt"))->toStartWith('badname');
});

it('requires an idempotency key and replays the same upload once', function (): void {
    $this->api = ($this->api)();
    $file = ($this->png)();

    $this->api->post('/api/v1/files', ['file' => $file])->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');

    $headers = ['Idempotency-Key' => 'same'];
    $first = $this->api->withHeaders($headers)->post('/api/v1/files', ['file' => $file])->assertCreated();
    $second = $this->api->withHeaders($headers)->post('/api/v1/files', ['file' => $file])->assertCreated();

    expect($second->json('data.id'))->toBe($first->json('data.id'))
        ->and(File::query()->count())->toBe(1)
        ->and(Storage::disk('local')->allFiles())->toHaveCount(1);
});

it('rejects files over 25 MB with FILE_TOO_LARGE', function (): void {
    ($this->upload)(UploadedFile::fake()->create('big.pdf', 25 * 1024 + 1))
        ->assertStatus(413)->assertJsonPath('errors.code', 'FILE_TOO_LARGE');
});

it('rejects empty files and a missing file', function (): void {
    ($this->upload)(UploadedFile::fake()->createWithContent('empty.txt', ''))->assertStatus(422);

    ($this->api)()->withHeader('Idempotency-Key', 'z')->post('/api/v1/files', [])
        ->assertStatus(422)->assertJsonStructure(['errors' => ['fields' => ['file']]]);
});

it('rejects extensions outside the allowlist', function (string $name): void {
    ($this->upload)(UploadedFile::fake()->createWithContent($name, 'hello'))
        ->assertStatus(422)->assertJsonPath('errors.code', 'UNSUPPORTED_FILE_TYPE');
    expect(File::query()->count())->toBe(0);
})->with(['shell.php', 'run.exe', 'page.html', 'vector.svg', 'noext', 'a.php.']);

it('sniffs content instead of trusting name or client mime', function (): void {
    ($this->upload)(UploadedFile::fake()->createWithContent('fake.pdf', '<?php echo 1;'))
        ->assertStatus(422)->assertJsonPath('errors.code', 'UNSUPPORTED_FILE_TYPE');

    ($this->upload)(UploadedFile::fake()->createWithContent('photo.png', "%PDF-1.4\n%%EOF\n"))
        ->assertStatus(422);

    ($this->upload)(UploadedFile::fake()->createWithContent('ok.pdf', "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"))
        ->assertCreated()->assertJsonPath('data.mime', 'application/pdf');

    ($this->upload)(UploadedFile::fake()->createWithContent('notes.txt', "plain text\n"))
        ->assertCreated()->assertJsonPath('data.mime', 'text/plain');
});

it('rejects infected files through the scanner hook', function (): void {
    app()->instance(FileScanner::class, new class implements FileScanner
    {
        public function scan(string $localPath, string $originalName): ScanResult
        {
            return ScanResult::infected('Eicar');
        }
    });

    ($this->upload)(($this->png)())->assertStatus(422)->assertJsonPath('errors.code', 'UNSUPPORTED_FILE_TYPE');
    expect(Storage::disk('local')->allFiles())->toBe([]);
});

it('defaults to a scanner that accepts everything', function (): void {
    expect(app(FileScanner::class)->scan('x', 'y')->clean)->toBeTrue();
});

it('shows metadata and lists with filters', function (): void {
    $id = ($this->upload)(($this->png)('a.png'))->json('data.id');
    ($this->upload)(UploadedFile::fake()->createWithContent('b.txt', 'text'));

    ($this->api)()->getJson("/api/v1/files/{$id}")->assertOk()->assertJsonPath('data.original_name', 'a.png');
    ($this->api)()->getJson('/api/v1/files')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.pagination.total', 2);
    ($this->api)()->getJson('/api/v1/files?q=b.t')->assertJsonCount(1, 'data');
    ($this->api)()->getJson('/api/v1/files/not-a-uuid')->assertNotFound();
});

it('streams downloads from a local disk as attachments', function (): void {
    $id = ($this->upload)(($this->png)('logo.png'))->json('data.id');

    $res = ($this->api)()->get("/api/v1/files/{$id}/download")->assertOk();
    $res->assertHeader('Content-Type', 'image/png')
        ->assertHeader('X-Content-Type-Options', 'nosniff');
    expect($res->headers->get('Content-Disposition'))->toContain('attachment')->toContain('logo.png')
        ->and($res->streamedContent())->toBe(PNG_BYTES);
});

it('redirects s3 downloads to a short lived signed url', function (): void {
    $id = ($this->upload)(($this->png)('logo.png'))->json('data.id');
    File::query()->whereKey($id)->update(['disk' => 's3']);

    config(['filesystems.disks.s3.driver' => 's3']);
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('temporaryUrl')->once()->withArgs(function (string $path, $expires, array $opts): bool {
        return str_starts_with($path, 'companies/'.$this->company.'/')
            && $expires->between(now()->addMinutes(4), now()->addMinutes(6))
            && str_contains($opts['ResponseContentDisposition'], 'attachment');
    })->andReturn('https://minio.test/keystone/signed?X-Amz-Signature=abc');
    Storage::set('s3', $disk);

    ($this->api)()->get("/api/v1/files/{$id}/download")
        ->assertRedirect('https://minio.test/keystone/signed?X-Amz-Signature=abc')
        ->assertHeader('Cache-Control', 'no-store, private');
});

it('soft deletes', function (): void {
    $id = ($this->upload)(($this->png)())->json('data.id');

    ($this->api)()->deleteJson("/api/v1/files/{$id}")->assertNoContent();
    ($this->api)()->getJson("/api/v1/files/{$id}")->assertNotFound();

    expect(File::query()->withTrashed()->whereKey($id)->exists())->toBeTrue();
});

it('hides files of other companies behind 404', function (): void {
    $id = ($this->upload)(($this->png)())->json('data.id');
    $elsewhere = SvcActors::company();

    ($this->api)(null, $elsewhere)->getJson("/api/v1/files/{$id}")->assertNotFound();
    ($this->api)(null, $elsewhere)->get("/api/v1/files/{$id}/download")->assertNotFound();
    ($this->api)(null, $elsewhere)->deleteJson("/api/v1/files/{$id}")->assertNotFound();
    ($this->api)(null, $elsewhere)->getJson('/api/v1/files')->assertJsonCount(0, 'data');

    SvcActors::activate($this->company);
    expect(File::query()->count())->toBe(1);
});

it('enforces file permissions', function (): void {
    $id = ($this->upload)(($this->png)())->json('data.id');
    $nobody = SvcActors::user();

    ($this->api)($nobody)->getJson('/api/v1/files')->assertForbidden();
    ($this->api)($nobody)->getJson("/api/v1/files/{$id}")->assertForbidden();
    ($this->api)($nobody)->get("/api/v1/files/{$id}/download")->assertForbidden();
    ($this->api)($nobody)->deleteJson("/api/v1/files/{$id}")->assertForbidden();
    ($this->upload)(($this->png)(), [], $nobody)->assertForbidden();

    $reader = SvcActors::user(['files.view']);
    ($this->api)($reader)->deleteJson("/api/v1/files/{$id}")->assertForbidden();

    Auth::forgetGuards();
    $this->getJson('/api/v1/files')->assertUnauthorized();
});

describe('attachments', function (): void {
    beforeEach(function (): void {
        Schema::create('svc_docs', function ($t): void {
            $t->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $t->uuid('company_id')->nullable();
        });
        $this->doc = AttachableDoc::query()->create(['id' => (string) Str::uuid7(), 'company_id' => $this->company]);
    });

    it('attaches to an Attachable record and exposes it through HasAttachments', function (): void {
        $res = ($this->upload)(($this->png)(), ['attachable_type' => AttachableDoc::class, 'attachable_id' => $this->doc->id])->assertCreated();

        expect($this->doc->attachments()->count())->toBe(1)
            ->and($res->json('data.attachable_id'))->toBe($this->doc->id);

        ($this->api)()->getJson('/api/v1/files?filter[attachable_id]='.$this->doc->id)->assertJsonCount(1, 'data');
    });

    it('refuses targets that are missing, foreign or not Attachable', function (): void {
        $foreign = AttachableDoc::query()->create(['id' => (string) Str::uuid7(), 'company_id' => SvcActors::company()]);

        foreach ([
            [AttachableDoc::class, (string) Str::uuid7()],
            [AttachableDoc::class, $foreign->id],
            [File::class, (string) Str::uuid7()],
            ['stdClass', (string) Str::uuid7()],
        ] as [$type, $id]) {
            ($this->upload)(($this->png)(), ['attachable_type' => $type, 'attachable_id' => $id])->assertStatus(422);
        }

        ($this->upload)(($this->png)(), ['attachable_type' => AttachableDoc::class])->assertStatus(422);
        expect(File::query()->count())->toBe(0);
    });
});
