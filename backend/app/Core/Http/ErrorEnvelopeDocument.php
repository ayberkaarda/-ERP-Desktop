<?php

declare(strict_types=1);

namespace App\Core\Http;

use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\ArrayType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;

/**
 * Publishes the error envelope and codes so clients can type them from OpenAPI.
 */
final class ErrorEnvelopeDocument
{
    public function __invoke(OpenApi $openApi): void
    {
        $code = (new StringType)->enum(array_map(
            static fn (ErrorCode $case): string => $case->value,
            ErrorCode::cases(),
        ));
        $codeRef = $openApi->components->addSchema('ErrorCode', Schema::fromType($code));

        $fields = (new ObjectType)->additionalProperties(
            (new ArrayType)->setItems(new StringType),
        );

        $error = (new ObjectType)
            ->addProperty('message', new StringType)
            ->addProperty('code', $codeRef)
            ->addProperty('fields', $fields)
            ->setRequired(['message', 'code']);

        $envelope = (new ObjectType)
            ->addProperty('errors', $error)
            ->setRequired(['errors']);

        $openApi->components->addSchema('ErrorEnvelope', Schema::fromType($envelope));
    }
}
