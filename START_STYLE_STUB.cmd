@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Style Stub AI Gateway - keep this window open

set "STYLE_STUB_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "STYLE_STUB_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if not exist "%STYLE_STUB_NODE%" (
  where "%STYLE_STUB_NODE%" >nul 2>nul
  if errorlevel 1 (
    echo Style Stub needs Node.js 20 or newer.
    echo Please install Node.js, then run this file again.
    pause
    exit /b 1
  )
)

echo Starting Style Stub AI Gateway...
echo Keep this window open while using AI. Closing it clears all connected keys.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process 'http://127.0.0.1:47820/'"
"%STYLE_STUB_NODE%" server\gateway.js

echo.
echo The gateway has stopped. Your connected keys have been cleared.
pause
