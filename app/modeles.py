"""Inventaire du dossier des modèles et recherche tolérante des fichiers."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from . import docx_moteur

EXTENSIONS = {".docx", ".docm", ".dotx"}


def cle_normalisee(chemin_relatif: str) -> str:
    """Clé de comparaison : sans accents, sans casse, espaces réduits, sans extension."""
    s = chemin_relatif.replace("\\", "/")
    s = re.sub(r"\.(docx|docm|dotx|doc|dot)$", "", s, flags=re.I)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+", " ", s).strip().lower()
    s = re.sub(r"\s*/\s*", "/", s)
    return s


class Inventaire:
    def __init__(self, dossier: Path):
        self.dossier = Path(dossier)
        self._cache_balises: dict[str, tuple[float, list[str]]] = {}
        self.rafraichir()

    def rafraichir(self):
        self.fichiers: list[str] = []
        self.non_convertis: list[str] = []
        if self.dossier.exists():
            for p in sorted(self.dossier.rglob("*")):
                if not p.is_file() or p.name.startswith("~$"):
                    continue
                rel = p.relative_to(self.dossier).as_posix()
                if rel.startswith("_"):
                    continue  # _sauvegardes, _origine…
                if p.suffix.lower() in EXTENSIONS:
                    self.fichiers.append(rel)
                elif p.suffix.lower() in (".doc", ".dot"):
                    self.non_convertis.append(rel)
        self._index = {cle_normalisee(f): f for f in self.fichiers}
        noms = {}
        for f in self.fichiers:
            noms.setdefault(cle_normalisee(Path(f).name), []).append(f)
        self._index_noms = {k: v[0] for k, v in noms.items() if len(v) == 1}

    def trouver(self, chemin_relatif: str) -> str | None:
        """Chemin réel d'un modèle : exact, puis tolérant (casse, accents, espaces,
        .doc/.docx), puis par nom de fichier seul s'il est unique."""
        if not chemin_relatif:
            return None
        rel = chemin_relatif.replace("\\", "/")
        if rel in self.fichiers:
            return rel
        cle = cle_normalisee(rel)
        if cle in self._index:
            return self._index[cle]
        return self._index_noms.get(cle_normalisee(Path(rel).name))

    def chemin(self, relatif: str) -> Path:
        return self.dossier / relatif

    def balises(self, relatif: str) -> list[str]:
        p = self.chemin(relatif)
        try:
            mtime = p.stat().st_mtime
        except OSError:
            return []
        cache = self._cache_balises.get(relatif)
        if cache and cache[0] == mtime:
            return cache[1]
        try:
            trouvees = docx_moteur.lister_balises(docx_moteur.DocumentWord(p))
        except Exception:
            trouvees = []
        self._cache_balises[relatif] = (mtime, trouvees)
        return trouvees
