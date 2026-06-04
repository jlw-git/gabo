// Agentic surfaces are product defaults now. Set a flag to "false", "0", or
// "off" to disable a capability for a given environment.
export function agenticFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized !== 'false' && normalized !== '0' && normalized !== 'off'
}
