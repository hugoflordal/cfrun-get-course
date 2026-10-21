# ControlFreak Run – hämta bana (test)

Testsida för klockappen ControlFreak Run (Garmin). Klockan öppnar sidan via Garmin Connect
(`Authentication.makeOAuthRequest`); löparen skannar banans QR-kod, och sidan skickar banan
tillbaka till klockan med `connectiq://oauth?course=<kod>`. Ingen server, inget sparas.

`watch.html` (och `index.html`, samma sida) är en kopia av Runs `public/garmin/watch.html` med
relativa sökvägar. Betaversionen av klockappen öppnar den här sidan; den publika öppnar
https://run.controlfreak.se/garmin/watch.html. Uppdatera genom att kopiera in Runs version igen.

`formats/` är banformatets avkodare ur orienteering-formats v0.7.0, och `jsQR.js` är QR-läsaren
(samma filer som i Run).
