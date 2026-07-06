; Inno Setup script for SpectraPaint.
; Build with:  ISCC.exe installer\SpectraPaint.iss
; It wraps the PyInstaller onedir output into a single SpectraPaintSetup.exe that:
;   - installs the app under the user's local Programs folder (no admin needed),
;   - creates the default data folder the app reads from,
;   - adds a Start-menu shortcut to that data folder so users can find where to drop data.

#define AppName "SpectraPaint"
#define AppVersion "0.1.0"
#define AppPublisher "NTNU"
#define AppExeName "SpectraPaint.exe"
; Path to the PyInstaller build output, at the repo top level (<repo>\dist\SpectraPaint).
#define DistDir SourcePath + "..\dist\SpectraPaint"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\SpectraPaint
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..
OutputBaseFilename=SpectraPaintSetup
; Build output (dist\SpectraPaint) and installer (SpectraPaintSetup.exe) go to the repo top level.
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "{#DistDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; The folder the app reads imaging data from by default (see backend/app/paths.py -> APP_DATA_DIR).
Name: "{localappdata}\NTNU\SpectraPaint\data"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\SpectraPaint Data Folder"; Filename: "{localappdata}\NTNU\SpectraPaint\data"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('Put your imaging data (e.g. an "old_man" project folder) into:' + #13#10 +
           ExpandConstant('{localappdata}\NTNU\SpectraPaint\data') + #13#10 + #13#10 +
           'A shortcut named "SpectraPaint Data Folder" was added to the Start Menu.',
           mbInformation, MB_OK);
end;
