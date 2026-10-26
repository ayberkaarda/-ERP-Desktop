<?php

declare(strict_types=1);

it('allows credentialed requests from the frontend origin', function (): void {
    $this->withHeaders([
        'Origin' => 'http://localhost:5173',
        'Access-Control-Request-Method' => 'GET',
    ])->options('/api/v1/health')
        ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
        ->assertHeader('Access-Control-Allow-Credentials', 'true');
});

it('never echoes a foreign origin', function (): void {
    $response = $this->withHeaders([
        'Origin' => 'http://evil.test',
        'Access-Control-Request-Method' => 'GET',
    ])->options('/api/v1/health');

    expect($response->headers->get('Access-Control-Allow-Origin'))->not->toBe('http://evil.test')
        ->and($response->headers->get('Access-Control-Allow-Origin'))->not->toBe('*');
});
