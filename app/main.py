"""Point d'entrée : démarre le serveur local et ouvre la fenêtre de l'application.

Options :
  --importer DOSSIER   importe des documents d'origine sans ouvrir l'interface
  --sans-fenetre       démarre le serveur sans ouvrir de fenêtre (tests)
  --port N             port d'écoute (par défaut : choisi automatiquement)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from logging.handlers import RotatingFileHandler
from pathlib import Path

from . import chemins, importation, systeme
from .serveur import IDENTIFIANT, Application, demarrer

journal = logging.getLogger("visites")
DELAI_FERMETURE = 75  # secondes sans signe de la fenêtre avant arrêt


def configurer_journal(travail: Path):
    dossier = travail / "donnees"
    dossier.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(dossier / "journal.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    journal.addHandler(h)
    journal.setLevel(logging.INFO)
    if sys.stderr and not getattr(sys, "frozen", False):
        journal.addHandler(logging.StreamHandler())


def instance_existante(travail: Path) -> str | None:
    """URL d'une instance déjà ouverte sur ce poste, sinon None."""
    fichier = travail / "donnees" / "instance.json"
    try:
        info = json.loads(fichier.read_text(encoding="utf-8"))
        with urllib.request.urlopen(f"http://127.0.0.1:{info['port']}/api/identite", timeout=1.5) as r:
            if json.load(r).get("application") == IDENTIFIANT:
                return info["url"]
    except Exception:  # noqa: BLE001
        return None
    return None


def ouvrir_fenetre(url: str, travail: Path):
    navigateur = systeme.trouver_edge()
    if navigateur:
        profil = Path(os.environ.get("LOCALAPPDATA", travail / "donnees")) / "VisitesPlongeurs" / "fenetre"
        profil.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.Popen([navigateur, f"--app={url}", f"--user-data-dir={profil}", "--no-first-run",
                              "--no-default-browser-check", "--disable-features=Translate",
                              "--window-size=1380,900"], creationflags=systeme.SANS_FENETRE)
            return
        except OSError as e:
            journal.warning("Fenêtre Edge impossible (%s), navigateur par défaut.", e)
    webbrowser.open(url)


def surveiller(app: Application, serveur):
    """Arrête le serveur quand la fenêtre est fermée (plus aucun signe de vie)."""
    debut = time.time()
    while True:
        time.sleep(5)
        silence = time.time() - app.dernier_signe
        if app.signes_recus and silence > DELAI_FERMETURE:
            break
        if not app.signes_recus and time.time() - debut > 600:
            break
    journal.info("Fenêtre fermée : arrêt.")
    serveur.shutdown()


def main(argv=None):
    p = argparse.ArgumentParser(prog="VisitesPlongeurs")
    p.add_argument("--importer", metavar="DOSSIER")
    p.add_argument("--sans-fenetre", action="store_true")
    p.add_argument("--port", type=int, default=0)
    args = p.parse_args(argv)

    travail = chemins.dossier_travail()
    configurer_journal(travail)

    if args.importer:
        app = Application(travail)
        rapport = importation.importer(Path(args.importer), app.dossier_modeles(),
                                       journal=lambda e: print(f"[{e['statut']:>9}] {e['modele']}  "
                                                               f"{', '.join(e['balises'])}  {' '.join(e['remarques'])}"))
        print(json.dumps(rapport["totaux"], ensure_ascii=False))
        return 0

    deja = instance_existante(travail)
    if deja and not args.sans_fenetre:
        ouvrir_fenetre(deja, travail)
        return 0

    app = Application(travail)
    serveur = demarrer(app, args.port)
    port = serveur.server_address[1]
    url = f"http://127.0.0.1:{port}/?t={app.jeton}"
    (travail / "donnees" / "instance.json").write_text(json.dumps({"port": port, "url": url}), encoding="utf-8")
    journal.info("Démarrage sur le port %s (dossier de travail : %s)", port, travail)
    if args.sans_fenetre:
        print(url, flush=True)
    else:
        threading.Thread(target=surveiller, args=(app, serveur), daemon=True).start()
        ouvrir_fenetre(url, travail)
    try:
        serveur.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            (travail / "donnees" / "instance.json").unlink()
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
