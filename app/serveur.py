"""Serveur local (127.0.0.1 uniquement) qui sert l'interface et l'API JSON."""
from __future__ import annotations

import json
import logging
import mimetypes
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__, chemins, config, docx_moteur, generation, importation, regles, systeme
from .modeles import Inventaire

journal = logging.getLogger("visites")
IDENTIFIANT = "visites-plongeurs"


class Application:
    def __init__(self, travail: Path):
        self.travail = travail
        self.jeton = secrets.token_urlsafe(24)
        self.verrou = threading.RLock()
        self.dernier_signe = time.time()
        self.signes_recus = False
        self.charger()

    # -- état
    def charger(self):
        with self.verrou:
            self.cfg = config.charger(self.travail)
            self.inventaire = Inventaire(self.dossier_modeles())

    def dossier_modeles(self) -> Path:
        return chemins.resoudre(self.travail, self.cfg["general"].get("dossier_modeles", "modeles"))

    def dossier_sortie(self) -> Path:
        return chemins.resoudre(self.travail, self.cfg["general"].get("dossier_sortie", "Documents générés"))

    def etat(self) -> dict:
        self.inventaire.rafraichir()
        return {
            "version": __version__,
            "windows": systeme.WINDOWS,
            "travail": str(self.travail),
            "dossier_modeles": str(self.dossier_modeles()),
            "dossier_sortie": str(self.dossier_sortie()),
            "config": self.cfg,
            "aptitudes_par_type": regles.aptitudes_par_type(self.cfg),
            "modeles": self.inventaire.fichiers,
            "non_convertis": self.inventaire.non_convertis,
        }

    def autorise(self, chemin: str) -> Path:
        """N'ouvre que des fichiers situés dans les dossiers de l'application."""
        p = Path(chemin).resolve()
        racines = [self.travail.resolve(), self.dossier_modeles().resolve(), self.dossier_sortie().resolve()]
        if not any(p == r or r in p.parents for r in racines):
            raise PermissionError("Emplacement non autorisé.")
        if not p.exists():
            raise FileNotFoundError(f"Introuvable : {p}")
        return p

    # -- actions
    def verifier_modeles(self) -> dict:
        self.inventaire.rafraichir()
        connues = {c["cle"] for c in self.cfg["champs"]} | regles.CLES_CALCULEES
        references, lignes = set(), []
        for categorie, liste in (("Fiche navette", self.cfg["fiches_axone"]), ("Certificat", self.cfg["certificats"])):
            for r in liste:
                chemin = self.inventaire.trouver(r["modele"])
                if chemin:
                    references.add(chemin)
                balises_doc = self.inventaire.balises(chemin) if chemin else []
                lignes.append({
                    "categorie": categorie, "modele": r["modele"], "trouve": chemin,
                    "types": r.get("types", []), "aptitudes": r.get("aptitudes", []),
                    "balises": balises_doc, "inconnues": [b for b in balises_doc if b not in connues],
                })
        orphelins = [f for f in self.inventaire.fichiers if f not in references]
        return {"lignes": lignes, "orphelins": orphelins, "non_convertis": self.inventaire.non_convertis,
                "manquants": sum(1 for l in lignes if not l["trouve"])}


def creer_gestionnaire(app: Application, dossier_web: Path):
    class Gestionnaire(BaseHTTPRequestHandler):
        server_version = "VisitesPlongeurs"

        def log_message(self, fmt, *args):  # journal applicatif plutôt que la console
            journal.debug("%s - %s", self.address_string(), fmt % args)

        # -- utilitaires
        def _json(self, code: int, donnees):
            corps = json.dumps(donnees, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corps)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corps)

        def _corps(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            return json.loads(self.rfile.read(n).decode("utf-8"))

        def _hote_local(self) -> bool:
            hote = (self.headers.get("Host") or "").split(":")[0]
            return hote in ("127.0.0.1", "localhost")

        # -- GET
        def do_GET(self):  # noqa: N802
            chemin = urlparse(self.path).path
            if not self._hote_local():
                return self._json(403, {"erreur": "Accès refusé"})
            if chemin == "/api/identite":
                return self._json(200, {"application": IDENTIFIANT, "version": __version__})
            if chemin.startswith("/api/"):
                return self._api("GET", chemin, {})
            if chemin in ("", "/"):
                chemin = "/index.html"
            fichier = (dossier_web / chemin.lstrip("/")).resolve()
            if dossier_web.resolve() not in fichier.parents or not fichier.is_file():
                self.send_error(404)
                return
            contenu = fichier.read_bytes()
            self.send_response(200)
            type_mime = mimetypes.guess_type(fichier.name)[0] or "application/octet-stream"
            if type_mime.startswith("text/") or type_mime in ("application/javascript", "image/svg+xml"):
                type_mime += "; charset=utf-8"
            self.send_header("Content-Type", type_mime)
            self.send_header("Content-Length", str(len(contenu)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
            self.end_headers()
            self.wfile.write(contenu)

        def do_POST(self):  # noqa: N802
            if not self._hote_local():
                return self._json(403, {"erreur": "Accès refusé"})
            try:
                corps = self._corps()
            except ValueError:
                return self._json(400, {"erreur": "Requête illisible"})
            self._api("POST", urlparse(self.path).path, corps)

        # -- API
        def _api(self, methode, chemin, corps):
            if self.headers.get("X-Jeton") != app.jeton:
                return self._json(401, {"erreur": "Session expirée : fermez et relancez l'application."})
            app.dernier_signe, app.signes_recus = time.time(), True
            if chemin == "/api/signe":
                return self._json(200, {"ok": True})
            try:
                with app.verrou:
                    reponse = self._router(methode, chemin, corps)
                if reponse is None:
                    return self._json(404, {"erreur": f"Action inconnue : {chemin}"})
                return self._json(200, reponse)
            except generation.SaisieIncomplete as e:
                return self._json(422, {"erreur": str(e), "alertes": e.alertes})
            except (ValueError, FileNotFoundError, PermissionError, RuntimeError) as e:
                return self._json(400, {"erreur": str(e)})
            except Exception as e:  # noqa: BLE001
                journal.exception("Erreur sur %s", chemin)
                return self._json(500, {"erreur": f"Erreur inattendue : {e}"})

        def _router(self, methode, chemin, c):
            if chemin == "/api/signe":
                return {"ok": True}
            if chemin == "/api/etat":
                return app.etat()
            if chemin == "/api/apercu":
                r = regles.calculer(app.cfg, c.get("saisie", {}), app.inventaire)
                r.pop("valeurs", None)
                return r
            if chemin == "/api/generer":
                return generation.generer(app.cfg, app.travail, app.inventaire, c.get("saisie", {}))
            if chemin == "/api/historique":
                return {"entrees": generation.Historique(app.travail).lire()}
            if chemin == "/api/historique/supprimer":
                generation.Historique(app.travail).supprimer(c.get("id", ""))
                return {"ok": True}
            if chemin == "/api/historique/vider":
                generation.Historique(app.travail).vider()
                return {"ok": True}
            if chemin == "/api/ouvrir":
                systeme.ouvrir(app.autorise(c.get("chemin", "")))
                return {"ok": True}
            if chemin == "/api/ouvrir-dossier":
                cible = {"modeles": app.dossier_modeles(), "sortie": app.dossier_sortie(),
                         "config": app.travail / "config"}.get(c.get("quel"))
                if cible is None:
                    raise ValueError("Dossier inconnu")
                cible.mkdir(parents=True, exist_ok=True)
                systeme.ouvrir(cible)
                return {"ok": True}
            if chemin == "/api/imprimer":
                for f in c.get("chemins", []):
                    systeme.imprimer(app.autorise(f))
                return {"ok": True}
            if chemin == "/api/ouvrir-modele":
                p = app.inventaire.trouver(c.get("modele", ""))
                if not p:
                    raise FileNotFoundError("Modèle introuvable")
                systeme.ouvrir(app.inventaire.chemin(p))
                return {"ok": True}
            if chemin == "/api/config":
                config.enregistrer(app.travail, c["config"])
                app.charger()
                return app.etat()
            if chemin == "/api/config/defaut":
                return {"config": config.defaut()}
            if chemin == "/api/config/controler":
                return {"erreurs": config.controler(c["config"])}
            if chemin == "/api/modeles/verifier":
                return app.verifier_modeles()
            if chemin == "/api/modeles/importer":
                source = Path(c.get("source", "").strip().strip('"'))
                rapport = importation.importer(source, app.dossier_modeles(),
                                               remplacer_etiquette=c.get("remplacer_etiquette", True))
                app.inventaire.rafraichir()
                return rapport
            if chemin == "/api/modeles/balises":
                p = app.inventaire.trouver(c.get("modele", ""))
                if not p:
                    raise FileNotFoundError("Modèle introuvable")
                doc = docx_moteur.DocumentWord(app.inventaire.chemin(p))
                return {"balises": docx_moteur.lister_balises(doc)}
            if chemin == "/api/parcourir":
                return {"chemin": systeme.choisir_dossier(c.get("titre", "Choisissez un dossier"))}
            if chemin == "/api/quitter":
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return {"ok": True}
            return None

    return Gestionnaire


def demarrer(app: Application, port: int = 0) -> ThreadingHTTPServer:
    dossier_web = chemins.dossier_ressources() / "web"
    serveur = ThreadingHTTPServer(("127.0.0.1", port), creer_gestionnaire(app, dossier_web))
    serveur.daemon_threads = True
    return serveur
