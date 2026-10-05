# Apply AI - lokaler Versand (seit 2026-10-05).
#
# Laeuft ueber die Windows-Aufgabenplanung zweimal taeglich auf Nikis PC,
# weil nur dort liegt, was zum echten Abschicken noetig ist: die eingeloggten
# Portal-Profile (engine/.auth/) und der Lebenslauf. Der Motor in GitHub
# Actions (05:00 UTC) findet, bewertet und schreibt - dieses Skript schickt ab:
#
#   freigabe  Telegram-Knopfdruecke abholen
#   mail      freigegebene Mail-Bewerbungen verschicken (prueft vorher, ob
#             die Anzeige noch online ist)
#   apply     freigegebene hokify/karriere-Bewerbungen abschicken
#   antwort   im Postfach nach Firmenantworten suchen
#
# Die .env bleibt auf DRY_RUN=1 / MAIL_TEST_MODE=1 (Sicherheitsnetz fuer
# Handaufrufe) - scharf geschaltet wird nur hier, fuer diesen Lauf.
#
# Von Hand starten:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\versand.ps1
# Einplanen:         siehe docs/stand.md, Abschnitt 2026-10-05 (macht Niki selbst)
# Protokolle:        engine/logs/versand-<datum>.log (30 Tage aufgehoben)

$ErrorActionPreference = "Continue"
$wurzel = Split-Path -Parent $PSScriptRoot
Set-Location $wurzel

$logs = Join-Path $wurzel "engine\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("versand-" + (Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")

$env:DRY_RUN = "0"
$env:MAIL_TEST_MODE = "0"
$env:HEADFUL = ""

foreach ($schritt in @("freigabe", "mail", "apply", "antwort")) {
  "=== $schritt  $(Get-Date -Format 'HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
  cmd /c "npm run $schritt >> `"$log`" 2>&1"
}

Get-ChildItem $logs -Filter "versand-*.log" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
