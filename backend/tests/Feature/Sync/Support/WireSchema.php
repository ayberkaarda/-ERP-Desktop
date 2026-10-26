<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;
use PHPUnit\Framework\Assert;

/**
 * Validates JSON against the contract schemas (contracts/**, draft 2020-12) with opis.
 * Schema $ids live under https://keystone-erp.invalid/contracts/, mapped onto the folder.
 */
final class WireSchema
{
    public const string PREFIX = 'https://keystone-erp.invalid/contracts/';

    private static ?Validator $validator = null;

    public static function contracts(): string
    {
        // tests/Feature/Sync/Support -> repository root; usable before the application boots (datasets).
        return dirname(__DIR__, 5).DIRECTORY_SEPARATOR.'contracts';
    }

    /**
     * @return list<string>|null error messages, null when valid
     */
    public static function errors(string $schema, mixed $data): ?array
    {
        $result = self::validator()->validate(self::objects($data), self::PREFIX.$schema);

        if ($result->isValid()) {
            return null;
        }

        $error = $result->error();
        $messages = [];

        foreach ($error === null ? [] : (new ErrorFormatter)->format($error, true) as $path => $list) {
            foreach ((array) $list as $message) {
                $messages[] = "{$path}: ".(is_string($message) ? $message : json_encode($message));
            }
        }

        return $messages === [] ? ['invalid'] : $messages;
    }

    /**
     * @param  string  $schema  path below contracts/, e.g. 'sync/pull.response.schema.json'
     */
    public static function assertValid(string $schema, mixed $data): void
    {
        $errors = self::errors($schema, $data);

        Assert::assertNull($errors, "Not valid against {$schema}:\n".implode("\n", $errors ?? [])."\n".json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    /**
     * Arrays decoded as associative arrays become JSON objects again (opis needs stdClass).
     */
    public static function objects(mixed $data): mixed
    {
        return json_decode(json_encode($data, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), false, 512, JSON_THROW_ON_ERROR);
    }

    private static function validator(): Validator
    {
        if (self::$validator === null) {
            self::$validator = new Validator;
            self::$validator->setMaxErrors(20);
            self::$validator->resolver()?->registerPrefix(self::PREFIX, self::contracts().DIRECTORY_SEPARATOR);
        }

        return self::$validator;
    }
}
