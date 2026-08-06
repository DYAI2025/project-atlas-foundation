# Foundation validation report

Generated: 2026-08-06T17:18:17Z

## Passed local gates

| Gate | Result |
|---|---|
| Clean lockfile install without lifecycle scripts | passed |
| Repository format and structural checks | passed |
| Secret-pattern scan | passed |
| Unit tests | 14 passed, 0 failed |
| Five attached archive SHA-256 checks | passed |
| Project intake schema | passed |
| Architecture decision schema | passed |
| Build manifest and command safety | passed |
| Registry, upstream lock, evidence, and release schemas | passed |

## Not run

- Bun/gbrain build and tests
- PostgreSQL/pgvector migration and RLS tests
- Docker Compose and systemd smoke
- VPS runtime and BGE-M3 benchmark
- tool-generated complete SBOM and vulnerability scan
- GitHub branch, PR, CI, and readback
- all 14 productive agent-publish release gates

## Honest maturity

`tested` for the isolated foundation primitives. Not `runtime_verified` and not a release candidate.
