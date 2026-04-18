/**
 * Bridge probe — discover undocumented Even Hub native methods.
 * Tries calling method names via callEvenApp() and logs results.
 *
 * Usage: import { probeBridge } from './bridge-probe'; probeBridge();
 */

import { GlassesSdk } from 'even-toolkit/sdk-wrapper';

let rawBridge: any = null;

async function getRawBridge(): Promise<any> {
  if (rawBridge) return rawBridge;
  rawBridge = await GlassesSdk.getRawBridge();
  return rawBridge;
}

/** Try calling a method and log the result. */
async function tryMethod(name: string, params?: any): Promise<{ method: string; result?: any; error?: string }> {
  try {
    const bridge = await getRawBridge();
    const result = await bridge.callEvenApp(name, params);
    return { method: name, result };
  } catch (e: any) {
    return { method: name, error: e?.message ?? String(e) };
  }
}

/** Probe all candidate method names. */
export async function probeBridge(): Promise<void> {
  console.log('[probe] Starting bridge method discovery...');

  // Methods from the demo app (BleManager.invokeMethod / Proto)
  const demoAppMethods = [
    'startEvenAI',
    'stopEvenAI',
    'sendEvenAIData',
    'micOn',
    'micOff',
    'sendHeartBeat',
    'exit',
    'getLegSn',
    'sendNotify',
    'sendNewAppWhiteListJson',
  ];

  // Possible AI config methods
  const aiConfigMethods = [
    'getAIConfig',
    'setAIConfig',
    'getEvenAIConfig',
    'setEvenAIConfig',
    'getAISettings',
    'setAISettings',
    'setCustomHost',
    'getCustomHost',
    'setAIHost',
    'getAIHost',
    'setLLMConfig',
    'getLLMConfig',
    'setDeepSeekConfig',
    'getDeepSeekConfig',
    'enableAI',
    'disableAI',
    'setAIEnabled',
    'getAIEnabled',
    'disableBuiltinIntents',
    'setIntentConfig',
    'getIntentConfig',
  ];

  // Display control methods
  const displayMethods = [
    'setDisplayDuration',
    'getDisplayDuration',
    'setResponseDuration',
    'setAIDisplayMode',
    'getAIDisplayMode',
    'setAutoScroll',
    'setScrollInterval',
    'setPageTimeout',
    'sendText',
    'sendAIText',
    'sendEvenAIReply',
    'displayText',
    'showText',
    'showNotification',
    'sendNotification',
  ];

  // BLE/device methods
  const bleMethods = [
    'getConnectedDevices',
    'getDeviceList',
    'getBleState',
    'sendBleData',
    'sendCommand',
    'sendBleCommand',
    'getGlassesStatus',
    'getFirmwareVersion',
    'getAppVersion',
    'getConfig',
    'setConfig',
    'getSettings',
    'setSettings',
    'getPreferences',
    'setPreferences',
  ];

  // Generic config/system methods
  const systemMethods = [
    'getAppConfig',
    'setAppConfig',
    'getFeatures',
    'setFeatures',
    'getCapabilities',
    'listMethods',
    'getMethods',
    'help',
    'debug',
    'getDebugInfo',
    'getSystemInfo',
    'getVersion',
  ];

  const allMethods = [
    ...demoAppMethods,
    ...aiConfigMethods,
    ...displayMethods,
    ...bleMethods,
    ...systemMethods,
  ];

  const results: Array<{ method: string; result?: any; error?: string }> = [];

  for (const method of allMethods) {
    const r = await tryMethod(method);
    results.push(r);

    if (r.error) {
      console.log(`[probe] ❌ ${method}: ${r.error}`);
    } else {
      console.log(`[probe] ✅ ${method}:`, r.result);
    }
  }

  // Summary
  const found = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  console.log('\n[probe] ═══════════ SUMMARY ═══════════');
  console.log(`[probe] Total probed: ${results.length}`);
  console.log(`[probe] Responded: ${found.length}`);
  console.log(`[probe] Failed: ${failed.length}`);

  if (found.length > 0) {
    console.log('\n[probe] ✅ WORKING METHODS:');
    for (const r of found) {
      console.log(`  ${r.method}:`, JSON.stringify(r.result));
    }
  }
}

/**
 * Try sending text directly to glasses via Even AI protocol.
 * Mimics what the demo app does with Proto.sendEvenAIData.
 */
export async function trySendTextToGlasses(text: string, mode: 'auto' | 'manual' | 'last' = 'manual'): Promise<void> {
  const statusByte = mode === 'auto' ? 0x30 : mode === 'last' ? 0x40 : 0x50;
  const newScreen = statusByte | 0x01;

  console.log(`[probe] Trying to send text to glasses: "${text.slice(0, 50)}..." mode=${mode} status=0x${statusByte.toString(16)}`);

  // Try various method names that might send text to glasses
  const attempts = [
    { method: 'sendEvenAIData', params: { text, newScreen, pos: 0, current_page_num: 1, max_page_num: 1 } },
    { method: 'sendEvenAIReply', params: { text, type: 0x01, status: statusByte, pos: 0 } },
    { method: 'sendText', params: { text, status: statusByte } },
    { method: 'sendAIText', params: { text, mode } },
    { method: 'displayText', params: { text } },
    { method: 'showText', params: { text } },
    { method: 'sendNotify', params: { text, title: 'AI' } },
  ];

  for (const attempt of attempts) {
    const r = await tryMethod(attempt.method, attempt.params);
    if (!r.error) {
      console.log(`[probe] ✅ ${attempt.method} worked:`, r.result);
      return;
    }
    console.log(`[probe] ❌ ${attempt.method}: ${r.error}`);
  }

  console.log('[probe] No text sending method found');
}

/** Intercept ALL bridge traffic for debugging. */
export function installBridgeInterceptor(): void {
  // Intercept outgoing messages
  const win = window as any;
  if (win.flutter_inappwebview?.callHandler) {
    const original = win.flutter_inappwebview.callHandler.bind(win.flutter_inappwebview);
    win.flutter_inappwebview.callHandler = function(name: string, ...args: any[]) {
      console.log('[bridge:OUT]', name, JSON.stringify(args).slice(0, 500));
      return original(name, ...args);
    };
    console.log('[probe] Outgoing bridge interceptor installed');
  }

  // Intercept incoming messages
  if (win._evenAppHandleMessage) {
    const original = win._evenAppHandleMessage;
    win._evenAppHandleMessage = function(msg: any) {
      console.log('[bridge:IN]', JSON.stringify(msg).slice(0, 500));
      return original(msg);
    };
    console.log('[probe] Incoming bridge interceptor installed');
  }
}
