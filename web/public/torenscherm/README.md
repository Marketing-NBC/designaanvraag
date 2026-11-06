# Foto's voor de torenscherm-preview

Bij een aanvraag met een **torenscherm** staat bovenaan de opleveringsmail geen gifje, maar deze foto
met het opgeleverde design op het scherm. Zie *Torenscherm-preview* in de README van de repository.

| Bestand | Locatie |
| --- | --- |
| `nbc-torenscherm.jpg` | NBC: het scherm bij de ingang |

Green Village heeft nog geen foto; daar krijgt de opleveringsmail gewoon een gifje.

## De foto vervangen

Het design wordt op vier hoekpunten gezet die op déze foto zijn opgemeten: de rand van het verlichte
deel van het scherm, binnen de zwarte omlijsting. Een andere foto betekent dus opnieuw opmeten.

1. Zet de nieuwe foto hier neer, liefst rond de 1100 px breed en onder de 250 KB.
2. Meet in pixels de vier hoeken van het scherm op: linksboven, rechtsboven, rechtsonder, linksonder.
3. Zet de bestandsnaam, de maat van de foto en de hoeken in `SCHERM_FOTOS` in
   `shared/torenscherm-preview.ts`, en draai `node scripts/sync-shared.mjs`.
4. Stuur jezelf een testmail (Actions → **Testmail versturen**, mail *oplevering*, locatie *nbc*) om
   te zien of het design precies op het scherm valt.

Een foto voor **Green Village** toevoegen gaat net zo, met een eigen regel `green_village` in
`SCHERM_FOTOS`. Vanaf dan krijgen opleveringen van een Green Village-torenscherm ook een preview.
