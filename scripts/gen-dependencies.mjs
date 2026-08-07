// Deterministic dependency register: third_party/upstreams.lock.json → DEPENDENCIES.md
// Zero dependencies, no network, no timestamps. Run: node scripts/gen-dependencies.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')
const DOC_PATH = join(repoRoot, 'DEPENDENCIES.md')

export function render(lock) {
  const rows = lock.upstreams.map(
    (u) =>
      `| ${u.id} | ${u.version} | \`${u.source_commit}\` | ${u.license} | \`${u.archive_sha256}\` | ${u.integration_status} | ${u.enabled ? 'yes' : 'no'} | ${u.approval_required ? 'yes' : 'no'} |`
  )
  return `# Dependencies (ATLAS-21)

> Generiert aus \`third_party/upstreams.lock.json\` durch \`scripts/gen-dependencies.mjs\`.
> Nicht von Hand editieren — Lock-Datei ändern und neu generieren:
> \`node scripts/gen-dependencies.mjs\`. Die Lock-Datei ist die autoritative Quelle;
> Rollen, Quell-URLs und Integrationshinweise stehen dort.

project_id: ATLAS

| Upstream | Version | Commit SHA | Lizenz | Archiv SHA-256 | Integrationsstatus | Enabled | Approval nötig |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Upgrade-Policy

1. Upstream-Pins werden nur per Pull Request aktualisiert, nie direkt auf main.
2. Ein Pin-Update nennt: neuen Commit-SHA, Diff-Zusammenfassung, Lizenz-Recheck,
   neuen Archiv-SHA-256 und das Ergebnis der Adapter-Regressionstests (ATLAS-22).
3. gbrain-evals wird vor Nutzung auf den gepinnten gbrain-Commit gepatcht
   (Abhängigkeit auf \`master\` ist verboten).
4. approval_required-Upstreams (Obsidian-Plugins) bleiben disabled, bis eine
   dokumentierte Owner-Entscheidung vorliegt (Approval Boundary §5/§6).
5. Sicherheitskritische Upgrades dürfen Phasen überspringen, brauchen aber
   dieselbe Evidenz.
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
  await writeFile(DOC_PATH, render(lock))
  console.log(`DEPENDENCIES.md written: ${lock.upstreams.length} upstreams`)
}
