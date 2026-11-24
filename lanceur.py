"""Lanceur utilisé par PyInstaller pour produire VisitesPlongeurs.exe."""
import os
import sys

# Programme sans console : redirige les sorties standard pour éviter les erreurs d'écriture.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

from app.main import main  # noqa: E402

sys.exit(main())
