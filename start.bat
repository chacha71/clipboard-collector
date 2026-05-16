@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 剪贴收集器启动中...
npx electron .
pause
