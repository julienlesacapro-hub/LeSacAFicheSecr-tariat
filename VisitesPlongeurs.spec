# -*- mode: python ; coding: utf-8 -*-
# Compilation : pyinstaller --noconfirm VisitesPlongeurs.spec
# Produit dist/VisitesPlongeurs/ (version « dossier », plus rapide au démarrage et
# moins souvent bloquée par les antivirus qu'un exécutable unique).

a = Analysis(
    ["lanceur.py"],
    pathex=["."],
    datas=[("app/web", "app/web"), ("app/defaut_config.json", "app")],
    hiddenimports=[
        "win32com", "win32com.client", "win32com.shell", "win32com.shell.shell",
        "win32com.shell.shellcon", "pythoncom", "pywintypes",
    ],
    excludes=["tkinter", "docx", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VisitesPlongeurs",
    console=False,
    icon="ressources/icone.ico",
    version="ressources/version_windows.txt",
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="VisitesPlongeurs", upx=False)
