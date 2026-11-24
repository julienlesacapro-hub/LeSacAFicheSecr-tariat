; Installateur Windows de Visites plongeurs (Inno Setup 6)
; Installation dans le profil de l'utilisateur : aucun droit administrateur requis.
#define Version "1.0.0"

[Setup]
AppId={{8C1E3D52-6E0B-4C59-9F3A-5C2D7A1B9E40}
AppName=Visites plongeurs
AppVersion={#Version}
AppPublisher=SMHEP
DefaultDirName={autopf}\Visites plongeurs
DefaultGroupName=Visites plongeurs
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=VisitesPlongeurs-installation
SetupIconFile=ressources\icone.ico
UninstallDisplayIcon={app}\VisitesPlongeurs.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "bureau"; Description: "Créer un raccourci sur le bureau"; GroupDescription: "Raccourcis :"

[Files]
Source: "dist\VisitesPlongeurs\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "config\config.json"; DestDir: "{app}\initial\config"; Flags: ignoreversion
Source: "modeles\*"; DestDir: "{app}\initial\modeles"; Flags: recursesubdirs ignoreversion skipifsourcedoesntexist
Source: "docs\GUIDE_UTILISATEUR.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "docs\PARAMETRAGE.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Visites plongeurs"; Filename: "{app}\VisitesPlongeurs.exe"
Name: "{autodesktop}\Visites plongeurs"; Filename: "{app}\VisitesPlongeurs.exe"; Tasks: bureau

[Run]
Filename: "{app}\VisitesPlongeurs.exe"; Description: "Lancer Visites plongeurs"; Flags: nowait postinstall skipifsilent
