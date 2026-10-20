<?php

declare(strict_types=1);

namespace App\Modules\Identity\Enums;

enum SessionEvent: string
{
    case Login = 'login';
    case Logout = 'logout';
    case Failed = 'failed';
    case Lockout = 'lockout';
    case TwoFactorFailed = 'two_factor_failed';
    case DeviceLogin = 'device_login';
    case Revoked = 'revoked';
}
