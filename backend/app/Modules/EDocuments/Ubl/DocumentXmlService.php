<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Ubl;

use App\Modules\EDocuments\Contracts\DocumentXml;
use App\Modules\EDocuments\Data\XmlDocumentSnapshot;
use App\Modules\EDocuments\Data\XmlValidationResult;
use App\Modules\EDocuments\Validation\OfficialValidator;

final readonly class DocumentXmlService implements DocumentXml
{
    public function __construct(private DocumentBuilder $builder, private DocumentReader $reader, private OfficialValidator $validator) {}

    public function available(): bool
    {
        return $this->validator->available();
    }

    public function generate(XmlDocumentSnapshot $snapshot): string
    {
        return $this->builder->build($snapshot->toArray());
    }

    public function validate(string $xml, string $kind): XmlValidationResult
    {
        return $this->validator->validate($xml, $kind);
    }

    public function parse(string $xml): XmlDocumentSnapshot
    {
        return XmlDocumentSnapshot::fromArray($this->reader->read($xml));
    }
}
