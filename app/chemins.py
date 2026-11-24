"""Emplacements des dossiers de l'application.

Deux modes :
* portable : un dossier « config » se trouve à côté de VisitesPlongeurs.exe ; tout
  (paramètres, modèles, documents générés) reste dans ce dossier ;
* installé : l'installateur ne place pas de dossier « config » à côté du programme ;
  les données vivent alors dans « Documents\\Visites plongeurs », créé au premier
  lancement à partir du sous-dossier « initial » livré avec le programme.
La variable d'environnement VISITES_PLONGEURS_DOSSIER impose un autre emplacement
(par exemple un lecteur réseau partagé par tout le secrétariat).
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def dossier_programme() -> Path:
    """Dossier qui contient l'exécutable (ou la racine des sources)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def dossier_ressources() -> Path:
    """Fichiers embarqués (interface web, configuration par défaut)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", dossier_programme())) / "app"
    return Path(__file__).resolve().parent


def _inscriptible(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
        essai = p / ".essai_ecriture"
        essai.write_text("ok", encoding="utf-8")
        essai.unlink()
        return True
    except OSError:
        return False


def dossier_documents() -> Path:
    """Dossier « Documents » réel de l'utilisateur (gère la redirection réseau ou OneDrive)."""
    if sys.platform.startswith("win"):
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]

            # FOLDERID_Documents {FDD39AD0-238F-46AF-ADB4-6C85480369C7}
            guid = GUID(0xFDD39AD0, 0x238F, 0x46AF, (ctypes.c_ubyte * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))
            chemin = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(chemin)) == 0:
                resultat = Path(chemin.value)
                ctypes.windll.ole32.CoTaskMemFree(chemin)
                return resultat
        except Exception:  # noqa: BLE001
            pass
    return Path.home() / "Documents"


def _initialiser(travail: Path, programme: Path):
    """Premier lancement en mode installé : recopie la configuration et les modèles livrés."""
    initial = programme / "initial"
    if not (travail / "config" / "config.json").exists() and (initial / "config").is_dir():
        shutil.copytree(initial / "config", travail / "config", dirs_exist_ok=True)
    modeles = travail / "modeles"
    vide = not modeles.exists() or not any(p.suffix.lower() == ".docx" for p in modeles.rglob("*"))
    if vide and (initial / "modeles").is_dir():
        shutil.copytree(initial / "modeles", modeles, dirs_exist_ok=True)


def dossier_travail() -> Path:
    """Dossier où vivent config/, modeles/, donnees/ et les documents générés."""
    force = os.environ.get("VISITES_PLONGEURS_DOSSIER")
    if force:
        return Path(force).resolve()
    programme = dossier_programme()
    portable = (programme / "config").is_dir() or (programme / "portable.txt").exists()
    if portable and _inscriptible(programme / "donnees"):
        return programme
    travail = dossier_documents() / "Visites plongeurs"
    if not _inscriptible(travail / "donnees"):
        travail = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "VisitesPlongeurs"
        travail.mkdir(parents=True, exist_ok=True)
    _initialiser(travail, programme)
    return travail


def resoudre(base: Path, chemin: str) -> Path:
    """Chemin relatif au dossier de travail, ou absolu tel quel."""
    p = Path(os.path.expandvars(os.path.expanduser(chemin)))
    return p if p.is_absolute() else (base / p)
