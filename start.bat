@echo off
chcp 65001 >nul
title File Manager

:: =============================================
:: File Manager 独立启动（无 Infinite-Canvas）
:: =============================================

set REPO=%~dp0
set REPO=%REPO:~0,-1%

echo 启动 File Manager...
echo 项目目录: %REPO%
echo.

node "%REPO%\server.js"

pause
