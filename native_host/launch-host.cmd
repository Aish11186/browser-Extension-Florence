@echo off
where py >nul 2>&1
if %errorlevel% equ 0 (
  py -3 "%~dp0host.py"
) else (
  python "%~dp0host.py"
)
