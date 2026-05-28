@echo off
title Shul Display Board
color 0B
node --version >nul 2>&1
if %errorlevel% neq 0 (echo Install Node.js from nodejs.org & pause & exit /b 1)
if not exist "node_modules" (echo Installing packages... & call npm install & echo Done!)
if not exist "data" mkdir data
if not exist "public\pdfs" mkdir public\pdfs
if not exist "public\logo" mkdir public\logo
echo.
echo  DISPLAY: http://localhost:3000/display  (pw: display123)
echo  ADMIN:   http://localhost:3000/admin    (pw: admin123)
echo  Keep this window open. Ctrl+C to stop.
echo.
node server.js
pause
