@echo off
setlocal
set "PHP84_DIR=C:\Users\Ayber\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe"
where php >nul 2>nul
if errorlevel 1 (
  set "PATH=%PHP84_DIR%;%PATH%"
) else (
  for /f "tokens=2" %%V in ('php -v 2^>nul ^| findstr /b /c:"PHP 8.4"') do set "PHP84_OK=1"
  if not defined PHP84_OK set "PATH=%PHP84_DIR%;%PATH%"
)
docker compose up -d
if errorlevel 1 exit /b 1
call :waitport 5433 || exit /b 1
call :waitport 6379 || exit /b 1
start "Keystone API" /D "%~dp0backend" cmd /k "php artisan serve --host=0.0.0.0 --port=8000"
start "Keystone Reverb" /D "%~dp0backend" cmd /k "php artisan reverb:start --host=0.0.0.0 --port=8080"
start "Keystone Queue" /D "%~dp0backend" cmd /k "php artisan queue:work"
start "Keystone Scheduler" /D "%~dp0backend" cmd /k "php artisan schedule:work"
start "Keystone Frontend" /D "%~dp0" cmd /k "npm run dev --workspace frontend"
exit /b 0

:waitport
set "PORT=%~1"
set /a ATTEMPTS=0
:waitloop
powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName 127.0.0.1 -Port %PORT% -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 exit /b 0
set /a ATTEMPTS+=1
if %ATTEMPTS% GEQ 60 (echo Timed out waiting for port %PORT%.& exit /b 1)
timeout /t 1 /nobreak >nul
goto waitloop

