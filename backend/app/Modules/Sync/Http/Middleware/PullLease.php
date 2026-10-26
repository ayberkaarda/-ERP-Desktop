<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Middleware;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Illuminate\Database\Connection;
use Throwable;
use WeakMap;

/**
 * The database side of a pull slot: one deadline for the whole request, counted from the moment
 * the slot was taken, not per statement or per transaction.
 *
 * - transaction_timeout and statement_timeout start at the full lease (a backstop for the
 *   REPEATABLE READ read, whose length depends on the data);
 * - before every statement of the connection the time left is checked: none left answers
 *   SERVER_ERROR (transient, Retry-After 1) without running it, and when the time left drops
 *   below the statement timeout by more than STEP_MS, statement_timeout is lowered to it, so a
 *   statement started late cannot run past the deadline either.
 *
 * end() puts back the values found before, setting by setting; a value that cannot be put back
 * (connection broken, transaction aborted) drops the connection, so a pooled or long-lived
 * worker never reuses a session with a pull's timeouts.
 */
final class PullLease
{
    private const array SETTINGS = ['transaction_timeout', 'statement_timeout'];

    /** The statement timeout follows the time left in steps of this size. */
    private const int STEP_MS = 100;

    /** @var WeakMap<Connection, self>|null active lease per connection */
    private static ?WeakMap $active = null;

    /** @var WeakMap<Connection, true>|null connections that carry the check hook */
    private static ?WeakMap $hooked = null;

    /** @var array<string, string> setting => value found before */
    private array $previous = [];

    private int $statementMs;

    private bool $adjusting = false;

    private function __construct(private readonly Connection $db, private readonly float $deadline, int $ms)
    {
        $this->statementMs = $ms;
    }

    public static function begin(Connection $db, int $ms): self
    {
        $lease = new self($db, microtime(true) + $ms / 1000, $ms);
        self::$active ??= new WeakMap;
        self::$hooked ??= new WeakMap;

        try {
            foreach (self::SETTINGS as $setting) {
                $before = $db->selectOne('SELECT current_setting(?) AS value', [$setting]);
                $value = is_object($before) && is_string($before->value ?? null) ? $before->value : '0';
                $db->select('SELECT set_config(?, ?, false)', [$setting, "{$ms}ms"]);
                // Tracked only once set: end() restores exactly what was changed.
                $lease->previous[$setting] = $value;
            }
        } catch (Throwable $e) {
            $lease->end();

            throw $e;
        }

        if (! isset(self::$hooked[$db])) {
            self::$hooked[$db] = true;
            $db->beforeExecuting(static function (string $query, array $bindings, Connection $connection): void {
                (self::$active[$connection] ?? null)?->check();
            });
        }

        self::$active[$db] = $lease;

        return $lease;
    }

    public function end(): void
    {
        if (self::$active !== null && (self::$active[$this->db] ?? null) === $this) {
            unset(self::$active[$this->db]);
        }

        try {
            foreach (array_reverse($this->previous, true) as $setting => $value) {
                $this->db->select('SELECT set_config(?, ?, false)', [$setting, $value]);
                unset($this->previous[$setting]);
            }
        } catch (Throwable) {
            $this->db->disconnect();
        }
    }

    private function check(): void
    {
        if ($this->adjusting) {
            return;
        }

        $left = (int) floor(($this->deadline - microtime(true)) * 1000);

        if ($left <= 0) {
            throw new ApiException(ErrorCode::ServerError, headers: ['Retry-After' => '1']);
        }

        if ($left < $this->statementMs - self::STEP_MS) {
            $this->adjusting = true;

            try {
                $this->db->select('SELECT set_config(?, ?, false)', ['statement_timeout', "{$left}ms"]);
                $this->statementMs = $left;
            } finally {
                $this->adjusting = false;
            }
        }
    }
}
