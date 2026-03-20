@echo off
chcp 65001 >nul
title 仓库资产管理系统
echo.
echo ========================================
echo     仓库资产管理系统 启动中...
echo ========================================
echo.
cd /d "%~dp0"
node server\index.js
pause
