# Dependencies (ATLAS-21)

> Generiert aus `third_party/upstreams.lock.json` durch `scripts/gen-dependencies.mjs`.
> Nicht von Hand editieren — Lock-Datei ändern und neu generieren:
> `node scripts/gen-dependencies.mjs`. Die Lock-Datei ist die autoritative Quelle;
> Rollen, Quell-URLs und Integrationshinweise stehen dort.

project_id: ATLAS

| Upstream | Version | Commit SHA | Lizenz | Archiv SHA-256 | Integrationsstatus | Enabled | Approval nötig |
|---|---|---|---|---|---|---|---|
| gbrain | 0.42.73.2 | `15b9863d13635d173562a54f55a1d388bfcf546b` | MIT | `369cc24da71ee49b65386863211e25ab5138997bd8e9096eea4f3dc0886adcfa` | required_pinned_source | yes | no |
| gbrain-evals | 0.2.0 | `565b80754ffa6abb9afb041026f2fab048aa7553` | MIT | `da256de75ee0dcce7f82fd19d471a59f4eb54758d9bf68c32760cd70ab460750` | required_adapter | yes | no |
| hermes-gbrain-bridge | 0.1.0 | `a057b5864b82c40a4575838689e238b86a622833` | MIT | `d4bd92d03c55d985c4460d09232a58e6ee0a736cb03884a91afa5a087ab834b9` | reference_only | no | no |
| obsidian-smart-connections | 4.7.2 | `92e8d56c668f7711054b3a9de16bb73c12e5fa83` | Smart Plugins License | `ecfdcae16769aa2d971641ee84576388a46c5088e3227de52c5f5d0eefe298eb` | optional_external | no | yes |
| obsidian-advanced-canvas | 6.5.0 | `11c822b8494b9d0a7c3b57031b5c30d8ff3cb174` | GPL-3.0 | `dd0ee003e99bbfa3223d858c0607fb76fcfa8e2eb865f40fd7f2989edcdf4503` | optional_external | no | yes |

## Upgrade-Policy

1. Upstream-Pins werden nur per Pull Request aktualisiert, nie direkt auf main.
2. Ein Pin-Update nennt: neuen Commit-SHA, Diff-Zusammenfassung, Lizenz-Recheck,
   neuen Archiv-SHA-256 und das Ergebnis der Adapter-Regressionstests (ATLAS-22).
3. gbrain-evals wird vor Nutzung auf den gepinnten gbrain-Commit gepatcht
   (Abhängigkeit auf `master` ist verboten).
4. approval_required-Upstreams (Obsidian-Plugins) bleiben disabled, bis eine
   dokumentierte Owner-Entscheidung vorliegt (Approval Boundary §5/§6).
5. Sicherheitskritische Upgrades dürfen Phasen überspringen, brauchen aber
   dieselbe Evidenz.
