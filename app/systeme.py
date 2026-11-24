"""Fonctions liées au système : ouvrir, imprimer, choisir un dossier, convertir des .doc.

Sous Windows, la conversion .doc → .docx passe par Word (le plus fidèle) via
pywin32, puis par PowerShell si pywin32 est indisponible, puis par LibreOffice.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

journal = logging.getLogger("visites")
WINDOWS = sys.platform.startswith("win")
SANS_FENETRE = 0x08000000 if WINDOWS else 0  # CREATE_NO_WINDOW


def ouvrir(chemin: str | Path):
    """Ouvre un fichier ou un dossier avec l'application associée."""
    chemin = str(chemin)
    if WINDOWS:
        os.startfile(chemin)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", chemin])
    else:
        subprocess.Popen(["xdg-open", chemin])


def imprimer(chemin: str | Path):
    """Envoie un document à l'imprimante par défaut (via Word sous Windows)."""
    if not WINDOWS:
        raise RuntimeError("L'impression directe n'est disponible que sous Windows.")
    os.startfile(str(chemin), "print")  # noqa: S606


def choisir_dossier(titre: str = "Choisissez un dossier") -> str | None:
    """Boîte de dialogue native de choix de dossier (Windows)."""
    if not WINDOWS:
        return None
    try:  # pywin32
        from win32com.shell import shell, shellcon  # type: ignore
        pidl, _, _ = shell.SHBrowseForFolder(0, None, titre, shellcon.BIF_RETURNONLYFSDIRS | 0x40)
        return shell.SHGetPathFromIDList(pidl).decode("mbcs") if pidl else None
    except Exception:  # noqa: BLE001
        pass
    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
        f"$f.Description = '{titre.replace(chr(39), chr(39) * 2)}';"
        "$f.ShowNewFolderButton = $true;"
        "if ($f.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.SelectedPath }"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
                           capture_output=True, timeout=600, creationflags=SANS_FENETRE)
        sortie = r.stdout.decode("utf-8", errors="replace").strip()
        return sortie or None
    except Exception as e:  # noqa: BLE001
        journal.warning("Boîte de dialogue indisponible : %s", e)
        return None


# --------------------------------------------------------------------------- #
#  Conversion .doc → .docx
# --------------------------------------------------------------------------- #
def _par_pywin32(paires):
    import pythoncom  # type: ignore
    import win32com.client  # type: ignore
    pythoncom.CoInitialize()
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    resultats = {}
    try:
        for src, dst in paires:
            try:
                d = word.Documents.Open(str(src), False, True, False)  # ConfirmConversions, ReadOnly, AddToRecent
                d.SaveAs2(str(dst), 16)  # wdFormatDocumentDefault (.docx)
                d.Close(False)
                resultats[str(src)] = None
            except Exception as e:  # noqa: BLE001
                resultats[str(src)] = str(e)
    finally:
        word.Quit()
        pythoncom.CoUninitialize()
    return resultats


def _par_powershell(paires):
    liste = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8-sig")
    for i, (src, dst) in enumerate(paires):
        liste.write(f"{i}|{src}|{dst}\n")
    liste.close()
    script = f"""
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
foreach ($ligne in Get-Content -LiteralPath '{liste.name}' -Encoding UTF8) {{
  $p = $ligne.Split('|'); if ($p.Count -lt 3) {{ continue }}
  try {{ $d = $w.Documents.Open($p[1], $false, $true, $false); $d.SaveAs2($p[2], 16); $d.Close($false); Write-Output "OK|$($p[0])" }}
  catch {{ Write-Output "KO|$($p[0])|$($_.Exception.Message)" }}
}}
$w.Quit()
"""
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                           capture_output=True, timeout=1800, creationflags=SANS_FENETRE)
        sortie = r.stdout.decode("utf-8", errors="replace")
    finally:
        os.unlink(liste.name)
    resultats = {}
    for ligne in sortie.splitlines():
        morceaux = ligne.strip().lstrip("﻿").split("|")
        if len(morceaux) >= 2 and morceaux[0] in ("OK", "KO") and morceaux[1].isdigit():
            src = str(paires[int(morceaux[1])][0])
            resultats[src] = None if morceaux[0] == "OK" else "|".join(morceaux[2:])
    if not resultats:
        raise RuntimeError(r.stderr.decode("utf-8", errors="replace")[:500] or "Word ne répond pas")
    return resultats


def trouver_libreoffice() -> str | None:
    for nom in ("soffice", "libreoffice"):
        p = shutil.which(nom)
        if p:
            return p
    for base in (os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", "")):
        p = Path(base) / "LibreOffice" / "program" / "soffice.exe"
        if base and p.exists():
            return str(p)
    return None


def _par_libreoffice(paires):
    soffice = trouver_libreoffice()
    if not soffice:
        raise RuntimeError("LibreOffice introuvable")
    resultats = {}
    with tempfile.TemporaryDirectory() as tmp:
        profil = Path(tmp) / "profil"
        for src, dst in paires:
            sortie = Path(tmp) / "sortie"
            sortie.mkdir(exist_ok=True)
            r = subprocess.run([soffice, f"-env:UserInstallation=file:///{profil.as_posix().lstrip('/')}",
                                "--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", str(sortie), str(src)],
                               capture_output=True, timeout=300, creationflags=SANS_FENETRE)
            produit = sortie / (Path(src).stem + ".docx")
            if produit.exists():
                Path(dst).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(produit), dst)
                resultats[str(src)] = None
            else:
                resultats[str(src)] = (r.stderr or r.stdout).decode("utf-8", "replace")[:300] or "échec"
    return resultats


def convertir_doc(paires: list[tuple[Path, Path]]) -> tuple[dict, str]:
    """Convertit des .doc en .docx. Retourne ({source: erreur_ou_None}, moteur_utilisé)."""
    if not paires:
        return {}, "aucun"
    for dst in (d for _, d in paires):
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
    essais = []
    if WINDOWS:
        essais += [("Word", _par_pywin32), ("Word (PowerShell)", _par_powershell)]
    essais.append(("LibreOffice", _par_libreoffice))
    derniere = None
    for nom, fonction in essais:
        try:
            res = fonction(paires)
            if any(v is None for v in res.values()):
                return res, nom
            derniere = next(iter(res.values()), None)
        except Exception as e:  # noqa: BLE001
            derniere = str(e)
            journal.info("Conversion par %s impossible : %s", nom, e)
    raise RuntimeError("Aucun moyen de convertir les fichiers .doc (ni Word ni LibreOffice). "
                       f"Dernière erreur : {derniere}. Ouvrez-les dans Word et faites "
                       "« Enregistrer sous » au format .docx, puis relancez l'import.")


def trouver_edge() -> str | None:
    if not WINDOWS:
        return shutil.which("microsoft-edge") or shutil.which("chromium") or shutil.which("google-chrome")
    candidats = []
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if base:
            candidats.append(Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe")
    for var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if base:
            candidats.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
    for c in candidats:
        if c.exists():
            return str(c)
    return shutil.which("msedge")
