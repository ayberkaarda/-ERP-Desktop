<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

abstract class AccountingController
{
    protected function actor(Request $request): ?string
    {
        $id = $request->user()?->getAuthIdentifier();

        return is_string($id) ? $id : null;
    }

    /**
     * Pulls filters ListQuery cannot express out of the request.
     *
     * @param  list<string>  $names
     * @return array{0: Request, 1: array<string, string>}
     */
    protected function customFilters(Request $request, array $names): array
    {
        $query = $request->query();
        $filters = is_array($query['filter'] ?? null) ? $query['filter'] : [];
        $custom = [];

        foreach ($names as $name) {
            if (array_key_exists($name, $filters)) {
                $value = $filters[$name];
                unset($filters[$name]);

                if (is_string($value) && $value !== '') {
                    $custom[$name] = $value;
                }
            }
        }

        $query['filter'] = $filters;

        if ($filters === []) {
            unset($query['filter']);
        }

        return [$request->duplicate($query), $custom];
    }

    protected function uuid(string $field, string $value): string
    {
        if (! Str::isUuid($value)) {
            throw ValidationException::withMessages([$field => [(string) __('validation.uuid', ['attribute' => $field])]]);
        }

        return $value;
    }

    protected function date(string $field, string $value): string
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1 || strtotime($value) === false) {
            throw ValidationException::withMessages([$field => [(string) __('validation.date_format', ['attribute' => $field, 'format' => 'Y-m-d'])]]);
        }

        return $value;
    }

    protected function amount(string $field, string $value): string
    {
        if (preg_match('/^\d{1,16}(\.\d{1,4})?$/', $value) !== 1) {
            throw ValidationException::withMessages([$field => [(string) __('validation.decimal', ['attribute' => $field, 'decimal' => '0-4'])]]);
        }

        return $value;
    }

    /** DELETE may carry the version the client saw. */
    protected function deleteVersion(Request $request): ?int
    {
        $version = $request->input('version', $request->query('version'));

        if ($version === null) {
            return null;
        }

        if ((! is_string($version) && ! is_int($version)) || ! ctype_digit((string) $version)) {
            throw ValidationException::withMessages(['version' => [(string) __('validation.integer', ['attribute' => 'version'])]]);
        }

        return (int) $version;
    }

    /**
     * @return array<string, mixed>
     */
    protected function resolve(JsonResource $resource, Request $request): array
    {
        return $resource->resolve($request);
    }
}
