// src/atlas65/paths.mjs
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
export const GBRAIN_CHECKOUT = join(repoRoot, 'third_party/gbrain-checkout')
export const BRAIN_HOME = join(repoRoot, 'out/atlas65/gbrain-home')
export const OUT_DIR = join(repoRoot, 'out/atlas65')
export const CAPTURE_PATH = join(OUT_DIR, 'source-capture.json')
export const RECEIPT_PATH = join(OUT_DIR, 'import-receipt.json')
export const SNAPSHOT_PATH = join(OUT_DIR, 'graph-snapshot.json')
export const PROVENANCE_PATH = join(OUT_DIR, 'provenance.json')
export const REQUEST_PATH = join(OUT_DIR, 'read-request.json')
export const CONTRACT_RESPONSE_PATH = join(OUT_DIR, 'contract-response.json')
