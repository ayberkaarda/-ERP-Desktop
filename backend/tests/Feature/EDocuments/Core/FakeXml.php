<?php

declare(strict_types=1);

namespace Tests\Feature\EDocuments\Core;

use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Data\XmlValidationResult;

final class FakeXml implements DocumentXml
{
    public bool $valid = true;

    public bool $isAvailable = true;

    public ?XmlDocumentSnapshot $incoming = null;

    public function available(): bool
    {
        return $this->isAvailable;
    }

    public function generate(XmlDocumentSnapshot $snapshot): string
    {
        return '<Fixture>'.htmlspecialchars(json_encode($snapshot->toArray(), JSON_THROW_ON_ERROR), ENT_XML1 | ENT_QUOTES).'</Fixture>';
    }

    public function validate(string $xml, string $kind): XmlValidationResult
    {
        return new XmlValidationResult($this->isAvailable, $this->valid, $this->valid ? [] : [['layer' => 'test', 'code' => 'INVALID', 'message' => 'Controlled fixture rejection']], metadata: ['signature_verified' => false]);
    }

    public function parse(string $xml): XmlDocumentSnapshot
    {
        return $this->incoming ?? throw new \RuntimeException('Incoming fixture is not set.');
    }
}
