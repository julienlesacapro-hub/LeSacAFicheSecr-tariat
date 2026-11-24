@echo off
rem Lance l'application sans compilation (Python 3.10 ou plus doit etre installe).
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py
%PY% -c "import lxml" 2>nul || %PY% -m pip install --user -r requirements.txt
%PY% -m app
