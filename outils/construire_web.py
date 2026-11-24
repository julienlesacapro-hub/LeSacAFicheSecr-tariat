"""Construit le site de l'application pour navigateur, téléphone et tablette.

    python outils/construire_web.py [dossier_sortie]     (par défaut : site/)

Le site reprend l'interface de app/web, le paramétrage livré (app/defaut_config.json)
et la version de app/__init__.py. Il ne contient AUCUN modèle Word ni donnée de patient :
chaque appareil importe ses modèles (paquet exporté par le logiciel Windows).
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent


def version() -> str:
    texte = (RACINE / "app" / "__init__.py").read_text(encoding="utf-8")
    return re.search(r'__version__\s*=\s*"([^"]+)"', texte).group(1)


def construire(sortie: Path) -> Path:
    if sortie.exists():
        shutil.rmtree(sortie)
    shutil.copytree(RACINE / "app" / "web", sortie)
    shutil.copy2(RACINE / "app" / "defaut_config.json", sortie / "defaut_config.json")
    v = version()
    (sortie / "version.json").write_text(json.dumps({"version": v}), encoding="utf-8")
    sw = sortie / "sw.js"
    # identifiant de cache : version + empreinte du contenu, pour que chaque publication se mette à jour
    empreinte = hashlib.sha256()
    for f in sorted(p for p in sortie.rglob("*") if p.is_file() and p.name != "sw.js"):
        empreinte.update(f.relative_to(sortie).as_posix().encode() + f.read_bytes())
    sw.write_text(sw.read_text(encoding="utf-8").replace("__VERSION__", f"{v}-{empreinte.hexdigest()[:10]}"), encoding="utf-8")
    (sortie / ".nojekyll").write_text("", encoding="utf-8")
    return sortie


if __name__ == "__main__":
    cible = Path(sys.argv[1]) if len(sys.argv) > 1 else RACINE / "site"
    print(construire(cible.resolve()))
