# ControlFreak Run – hämta bana (test)

Testsida för klockappen ControlFreak Run (Garmin). Klockan öppnar sidan via Garmin Connect
(`Authentication.makeOAuthRequest`); löparen skannar banans QR-kod, och sidan skickar banan
tillbaka till klockan med `connectiq://oauth?course=<kod>`. Ingen server, inget sparas.

`formats/` är banformatets avkodare ur orienteering-formats v0.7.0.
