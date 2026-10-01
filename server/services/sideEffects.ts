export class SideEffectBlockedError extends Error {
  constructor(action: string) {
    super(`Bloqueado neste ambiente (homologação/manutenção): ${action} não é executado.`);
    this.name = "SideEffectBlockedError";
  }
}

export function sideEffectsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIDE_EFFECTS_ENABLED !== "false" && env.READ_ONLY !== "true";
}

export function assertSideEffectsAllowed(action: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!sideEffectsEnabled(env)) throw new SideEffectBlockedError(action);
}
