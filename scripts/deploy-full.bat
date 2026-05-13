@echo off
title Deploy COMPLETO - sebas-reviews
cd /d "%~dp0.."
echo ===============================================
echo  Deploy COMPLETO
echo  Pubblica: hosting + functions + regole Firestore/Storage.
echo  Piu' lento (le Cloud Functions richiedono tempo).
echo ===============================================
echo.
call firebase deploy
echo.
echo ===============================================
echo  Deploy completo terminato.
echo ===============================================
pause
