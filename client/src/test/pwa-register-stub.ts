// vite-plugin-pwa's virtual module does not exist under vitest.
export function registerSW(): () => Promise<void> {
  return async () => {};
}
