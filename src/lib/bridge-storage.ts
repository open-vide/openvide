function getBridge(): any {
  const bridge = (window as any).__evenBridge;
  if (bridge?.setLocalStorage) return bridge;
  if (bridge?.rawBridge?.setLocalStorage) return bridge.rawBridge;
  return null;
}

async function getRawBridge(): Promise<any> {
  const existing = getBridge();
  if (existing) return existing;
  try {
    const { EvenBetterSdk } = await import('@jappyjan/even-better-sdk');
    const raw = await Promise.race([
      EvenBetterSdk.getRawBridge(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return raw;
  } catch {
    return null;
  }
}

async function getStorageBridge(): Promise<any> {
  return getBridge() ?? await getRawBridge();
}

export async function storageGetRaw(key: string): Promise<string> {
  const bridge = await getStorageBridge();
  if (!bridge?.getLocalStorage) return '';
  try {
    const value = await bridge.getLocalStorage(key);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export async function storageSetRaw(key: string, value: string): Promise<void> {
  const bridge = await getStorageBridge();
  if (!bridge?.setLocalStorage) return;
  try {
    await bridge.setLocalStorage(key, value);
  } catch {
    // Ignore bridge storage failures; callers already handle empty-state fallbacks.
  }
}

export async function storageRemove(key: string): Promise<void> {
  await storageSetRaw(key, '');
}
