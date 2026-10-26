<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Data;

final readonly class XmlValidationResult
{
    /**
     * @param  list<array{layer:string,code:string,message:string,path?:string}>  $errors
     * @param  list<string>  $warnings
     * @param  array<string, mixed>  $metadata
     */
    public function __construct(
        public bool $available,
        public bool $valid,
        public array $errors = [],
        public array $warnings = [],
        public array $metadata = [],
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['available' => $this->available, 'valid' => $this->valid, 'errors' => $this->errors, 'warnings' => $this->warnings, 'metadata' => $this->metadata];
    }
}
