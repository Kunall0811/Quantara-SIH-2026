@echo off
setlocal

echo ============================================
echo   Q-ROUTE INDIA - Starting full stack
echo ============================================

if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    pushd backend
    call npm install
    popd
)

if not exist "backend\.env" (
    echo Creating backend\.env from template...
    copy backend\.env.example backend\.env
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd frontend
    call npm install
    popd
)

echo Starting backend on http://localhost:5000 ...
start "Q-ROUTE INDIA Backend" cmd /k "cd backend && npm run dev"

timeout /t 4 /nobreak >nul

echo Starting frontend on http://localhost:5173 ...
start "Q-ROUTE INDIA Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 3 /nobreak >nul

echo Opening browser...
start http://localhost:5173

echo.
echo ============================================
echo   Q-ROUTE INDIA is starting in two windows.
echo   Backend:  http://localhost:5000
echo   Frontend: http://localhost:5173
echo.
echo   Demo logins:
echo     citizen@qroute.in / citizen123
echo     admin@qroute.in   / admin123
echo ============================================
echo.
echo Manual commands (if you prefer):
echo   cd backend  ^&^& npm install ^&^& npm run dev
echo   cd frontend ^&^& npm install ^&^& npm run dev
echo.
pause
