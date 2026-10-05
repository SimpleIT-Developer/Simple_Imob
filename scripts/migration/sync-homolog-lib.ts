const DUMP_RE = /^imob-.*\.dump$/;

// Nomes de dump carregam o horário ISO, então a ordem alfabética é a cronológica.
export function dumpsToDelete(files: string[], keep: number): string[] {
  const dumps = files.filter((f) => DUMP_RE.test(f)).sort();
  return dumps.slice(0, Math.max(0, dumps.length - keep));
}

export function isLockStale(lockedAtMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - lockedAtMs > maxAgeMs;
}
