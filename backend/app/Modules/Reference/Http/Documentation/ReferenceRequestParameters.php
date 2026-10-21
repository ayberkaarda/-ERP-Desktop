<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Documentation;

use App\Modules\Reference\Http\Controllers\ReferenceController;
use App\Modules\Reference\Http\Requests\ReferenceRequest;
use Dedoc\Scramble\Support\Generator\TypeTransformer;
use Dedoc\Scramble\Support\OperationExtensions\ParameterExtractor\ParameterExtractor;
use Dedoc\Scramble\Support\OperationExtensions\RulesExtractor\GeneratesParametersFromRules;
use Dedoc\Scramble\Support\OperationExtensions\RulesExtractor\ParametersExtractionResult;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * API document: one controller serves every reference resource (route default `resource`), so the
 * generic form request extractor cannot know the rules. This extractor documents the request body
 * of each route from ReferenceRequest::rulesFor(resource, method): POST without `version`, PATCH
 * partial with `version` required.
 */
final class ReferenceRequestParameters implements ParameterExtractor
{
    use GeneratesParametersFromRules;

    public function __construct(private readonly TypeTransformer $openApiTransformer) {}

    public function handle(RouteInfo $routeInfo, array $parameterExtractionResults): array
    {
        $resource = $routeInfo->route->defaults['resource'] ?? null;
        $method = strtoupper($routeInfo->method);

        if ($routeInfo->className() !== ReferenceController::class || ! is_string($resource) || ! in_array($method, ['POST', 'PATCH', 'PUT', 'DELETE'], true)) {
            return $parameterExtractionResults;
        }

        $parameterExtractionResults[] = new ParametersExtractionResult(
            parameters: $this->makeParameters($this->rules($resource, $method), $this->openApiTransformer, [], 'body'),
            sourceClass: ReferenceRequest::class,
        );

        return $parameterExtractionResults;
    }

    /**
     * Laravel rule arrays, passed on as Scramble's rule sets (its RuleSet docblock type names no
     * class, so the value is handed over untyped).
     */
    private function rules(string $resource, string $method): mixed
    {
        return ReferenceRequest::rulesFor($resource, $method);
    }
}
