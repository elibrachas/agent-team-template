@echo off
rem Abre la Hoja del dia (el tablero del Project Lead) en el navegador.
rem Doble click y listo. Deja esta ventana abierta mientras lo uses; cerrarla apaga el tablero.
cd /d "%~dp0.."
node lead\app\server.mjs --open
if errorlevel 1 pause
