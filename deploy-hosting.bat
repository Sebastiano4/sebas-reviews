@echo off
title Deploy Hosting - sebas-reviews
cd /d "%~dp0"
echo ===============================================
echo  Deploy SOLO HOSTING (sito web)
echo  Veloce: aggiorna solo i file del sito.
echo ===============================================
echo.
call firebase deploy --only hosting
echo.
echo ===============================================
echo  Deploy hosting completato.
echo ===============================================
pause
