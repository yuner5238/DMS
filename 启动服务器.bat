@echo off
chcp 65001 >nul
title 仓库资产管理系统
echo.
echo ========================================
echo     仓库资产管理系统 启动中...
echo ========================================
echo.
cd /d "%~dp0"

echo 检查端口占用情况...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 发现端口3000被占用，PID: %%a，正在停止...
    taskkill /F /PID %%a >nul 2>&1
    echo 已停止进程
)

echo.
echo 启动服务器...
node server\index.js
pause
