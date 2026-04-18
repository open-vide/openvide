import { useState, useRef, useEffect } from 'react';

interface LogEntry {
  ts: string;
  tag: string;
  color: string;
  message: string;
}

function now(): string {
  return new Date().toLocaleTimeString();
}

export function BridgeProbeRoute() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [customMethod, setCustomMethod] = useState('');
  const [customParams, setCustomParams] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const log = (tag: string, message: string, color = '#60a5fa') => {
    setLogs(prev => [...prev, { ts: now(), tag, color, message }]);
  };
  const logOk = (tag: string, message: string) => log(tag, message, '#4ade80');
  const logErr = (tag: string, message: string) => log(tag, message, '#f87171');
  const logInfo = (tag: string, message: string) => log(tag, message, '#60a5fa');

  // ── Inspect window for bridge objects ──
  const inspectWindow = () => {
    const win = window as any;
    logInfo('INSPECT', '--- Checking window objects ---');

    // Check EvenAppBridge
    if (win.EvenAppBridge) {
      logOk('window.EvenAppBridge', typeof win.EvenAppBridge + ' — ' + Object.keys(win.EvenAppBridge).join(', '));
      // Try to list methods
      try {
        const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(win.EvenAppBridge));
        logOk('EvenAppBridge methods', proto.join(', '));
      } catch (e: any) {
        logErr('EvenAppBridge proto', e.message);
      }
    } else {
      logErr('window.EvenAppBridge', 'NOT FOUND');
    }

    // Check flutter_inappwebview
    if (win.flutter_inappwebview) {
      logOk('window.flutter_inappwebview', typeof win.flutter_inappwebview + ' — keys: ' + Object.keys(win.flutter_inappwebview).join(', '));
      if (win.flutter_inappwebview.callHandler) {
        logOk('flutter_inappwebview.callHandler', 'EXISTS (' + typeof win.flutter_inappwebview.callHandler + ')');
      }
    } else {
      logErr('window.flutter_inappwebview', 'NOT FOUND');
    }

    // Check _evenAppHandleMessage
    if (win._evenAppHandleMessage) {
      logOk('window._evenAppHandleMessage', typeof win._evenAppHandleMessage);
    } else {
      logErr('window._evenAppHandleMessage', 'NOT FOUND');
    }

    // Check EvenBetterSdk presence
    try {
      if (win.EvenBetterSdk) logOk('window.EvenBetterSdk', 'EXISTS');
    } catch { /* */ }

    // Dump all window keys that contain "even", "bridge", "flutter", "ble", "ai"
    const interesting = Object.keys(win).filter(k => {
      const lower = k.toLowerCase();
      return lower.includes('even') || lower.includes('bridge') || lower.includes('flutter') ||
             lower.includes('ble') || lower.includes('ai') || lower.includes('glass') ||
             lower.includes('native') || lower.includes('webkit');
    });
    if (interesting.length > 0) {
      logOk('Interesting window keys', interesting.join(', '));
    } else {
      logInfo('Window keys', 'No interesting keys found (even/bridge/flutter/ble/ai/glass/native)');
    }

    // Dump ALL window keys for reference
    const allCustomKeys = Object.keys(win).filter(k => {
      // Skip standard browser globals
      return !['location', 'document', 'navigator', 'screen', 'history',
               'sessionStorage', 'console', 'performance', 'crypto', 'fetch', 'alert',
               'confirm', 'prompt', 'close', 'open', 'print', 'name', 'length',
               'frames', 'self', 'top', 'parent', 'opener', 'window',
               'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
               'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
               'screenX', 'screenY', 'screenLeft', 'screenTop',
               'devicePixelRatio', 'visualViewport', 'statusbar', 'toolbar',
               'menubar', 'personalbar', 'scrollbars', 'locationbar',
               'origin', 'isSecureContext', 'crossOriginIsolated',
               'scheduler', 'indexedDB', 'caches', 'cookieStore',
               'onbeforeunload', 'onhashchange', 'onlanguagechange',
               'onmessage', 'onmessageerror', 'onpopstate', 'onrejectionhandled',
               'onstorage', 'onunhandledrejection', 'onunload',
               'customElements', 'speechSynthesis', 'trustedTypes',
               'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
               'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
               'setInterval', 'clearInterval', 'queueMicrotask',
               'structuredClone', 'atob', 'btoa', 'createImageBitmap',
               'reportError', 'getSelection', 'postMessage',
               ].includes(k) && !k.startsWith('on') && typeof win[k] !== 'undefined';
    }).slice(0, 50);
    logInfo('All window keys (first 50 non-standard)', allCustomKeys.join(', '));
  };

  // ── Try calling a method via multiple strategies ──
  const tryCall = async (method: string, params?: any): Promise<{ ok: boolean; result?: any; error?: string }> => {
    const win = window as any;

    // Strategy 1: EvenAppBridge.callEvenApp
    if (win.EvenAppBridge?.callEvenApp) {
      try {
        const result = await win.EvenAppBridge.callEvenApp(method, params);
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, error: `callEvenApp: ${e.message}` };
      }
    }

    // Strategy 2: Direct flutter_inappwebview.callHandler
    if (win.flutter_inappwebview?.callHandler) {
      try {
        const msg = { type: 'call_even_app_method', method, data: params };
        const result = await win.flutter_inappwebview.callHandler('evenAppMessage', msg);
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, error: `callHandler: ${e.message}` };
      }
    }

    // Strategy 3: GlassesSdk (toolkit)
    try {
      const { GlassesSdk } = await import('even-toolkit/sdk-wrapper');
      const bridge = await Promise.race([
        GlassesSdk.getRawBridge(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]) as any;
      const result = await bridge.callEvenApp(method, params);
      return { ok: true, result };
    } catch (e: any) {
      return { ok: false, error: `SDK: ${e.message}` };
    }
  };

  // ── Probe all methods ──
  const runProbe = async () => {
    setRunning(true);
    logInfo('PROBE', '--- Starting method probe ---');

    const methods = [
      'startEvenAI', 'stopEvenAI', 'sendEvenAIData', 'micOn', 'micOff',
      'sendHeartBeat', 'exit', 'getLegSn', 'sendNotify', 'sendNewAppWhiteListJson',
      'getAIConfig', 'setAIConfig', 'getEvenAIConfig', 'setEvenAIConfig',
      'getAISettings', 'setAISettings', 'setCustomHost', 'getCustomHost',
      'setAIHost', 'getAIHost', 'setLLMConfig', 'getLLMConfig',
      'enableAI', 'disableAI', 'setAIEnabled', 'getAIEnabled',
      'disableBuiltinIntents', 'setIntentConfig', 'getIntentConfig',
      'setDisplayDuration', 'getDisplayDuration', 'setResponseDuration',
      'setAIDisplayMode', 'getAIDisplayMode', 'setAutoScroll',
      'sendText', 'sendAIText', 'sendEvenAIReply', 'displayText', 'showText',
      'showNotification', 'sendNotification',
      'getConnectedDevices', 'getDeviceList', 'getBleState',
      'sendBleData', 'sendCommand', 'sendBleCommand',
      'getGlassesStatus', 'getFirmwareVersion', 'getAppVersion',
      'getConfig', 'setConfig', 'getSettings', 'setSettings',
      'getPreferences', 'setPreferences', 'getAppConfig', 'setAppConfig',
      'getFeatures', 'setFeatures', 'getCapabilities',
      'listMethods', 'getMethods', 'help', 'debug', 'getDebugInfo',
      'getSystemInfo', 'getVersion',
      // SDK documented methods
      'getUserInfo', 'getGlassesInfo', 'getDeviceInfo',
      'getLocalStorage', 'audioControl', 'shutDownPageContainer',
    ];

    for (const method of methods) {
      const r = await tryCall(method);
      if (r.ok) {
        logOk(method, JSON.stringify(r.result) ?? 'undefined');
      } else {
        logErr(method, r.error ?? 'unknown');
      }
    }

    logInfo('PROBE', '--- Probe complete ---');
    setRunning(false);
  };

  // ── Install interceptor ──
  const installInterceptor = () => {
    const win = window as any;
    let count = 0;

    // Intercept outgoing calls via flutter_inappwebview.callHandler
    if (win.flutter_inappwebview?.callHandler) {
      const original = win.flutter_inappwebview.callHandler.bind(win.flutter_inappwebview);
      win.flutter_inappwebview.callHandler = async function(name: string, ...args: any[]) {
        const argStr = JSON.stringify(args).slice(0, 400);
        setLogs(prev => [...prev, {
          ts: now(), tag: `OUT:${name}`, color: '#fbbf24',
          message: argStr,
        }]);
        const result = await original(name, ...args);
        setLogs(prev => [...prev, {
          ts: now(), tag: `RES:${name}`, color: '#fb923c',
          message: JSON.stringify(result)?.slice(0, 400) ?? 'undefined',
        }]);
        return result;
      };
      count++;
    }

    // Intercept _listenEvenAppMessage (found on window instead of _evenAppHandleMessage)
    if (win._listenEvenAppMessage) {
      const original = win._listenEvenAppMessage;
      win._listenEvenAppMessage = function(...args: any[]) {
        const str = JSON.stringify(args).slice(0, 400);
        setLogs(prev => [...prev, {
          ts: now(), tag: 'IN:_listenEvenAppMessage', color: '#c084fc',
          message: str,
        }]);
        return original(...args);
      };
      count++;
    }

    // Also try _evenAppHandleMessage
    if (win._evenAppHandleMessage) {
      const original = win._evenAppHandleMessage;
      win._evenAppHandleMessage = function(msg: any) {
        const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
        setLogs(prev => [...prev, {
          ts: now(), tag: 'IN:_evenAppHandleMessage', color: '#c084fc',
          message: str.slice(0, 400),
        }]);
        return original(msg);
      };
      count++;
    }

    // Hook into EvenAppBridge.handleEvenAppMessage directly
    if (win.EvenAppBridge?.handleEvenAppMessage) {
      const original = win.EvenAppBridge.handleEvenAppMessage.bind(win.EvenAppBridge);
      win.EvenAppBridge.handleEvenAppMessage = function(msg: any) {
        const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
        setLogs(prev => [...prev, {
          ts: now(), tag: 'IN:bridge.handleMsg', color: '#e879f9',
          message: str.slice(0, 400),
        }]);
        return original(msg);
      };
      count++;
    }

    logInfo('INTERCEPT', `Installed ${count} interceptor(s). Now trigger Even AI or interact with glasses!`);
  };

  // ── Custom call ──
  const runCustom = async () => {
    if (!customMethod.trim()) return;
    let params: any = undefined;
    if (customParams.trim()) {
      try { params = JSON.parse(customParams); } catch {
        logErr(customMethod, 'Invalid JSON params');
        return;
      }
    }
    logInfo('CALL', `Calling ${customMethod}(${customParams || ''})...`);
    const r = await tryCall(customMethod.trim(), params);
    if (r.ok) logOk(customMethod, JSON.stringify(r.result) ?? 'undefined');
    else logErr(customMethod, r.error ?? 'unknown');
  };

  // ── Probe raw callHandler with different handler names and message formats ──
  const probeHandlers = async () => {
    const win = window as any;
    const callHandler = win.flutter_inappwebview?.callHandler;
    if (!callHandler) {
      logErr('HANDLERS', 'flutter_inappwebview.callHandler not found');
      return;
    }

    logInfo('HANDLERS', '--- Probing callHandler with different handler names ---');

    // First, dump all keys on flutter_inappwebview (the numeric ones might be handler IDs)
    const fkeys = Object.keys(win.flutter_inappwebview);
    logInfo('HANDLERS', `flutter_inappwebview keys: ${fkeys.join(', ')}`);

    // Try different handler names
    const handlerNames = [
      'evenAppMessage',        // known working
      'evenAIMessage',
      'bleMessage',
      'bleCommand',
      'sendBleData',
      'nativeMessage',
      'appMessage',
      'glassesMessage',
      'deviceMessage',
      'aiMessage',
      'configMessage',
      'settingsMessage',
    ];

    for (const name of handlerNames) {
      try {
        const msg = { type: 'call_even_app_method', method: 'getUserInfo', data: {} };
        const result = await Promise.race([
          callHandler.call(win.flutter_inappwebview, name, msg),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 3s')), 3000)),
        ]);
        logOk(`handler:${name}`, JSON.stringify(result)?.slice(0, 300) ?? 'undefined');
      } catch (e: any) {
        logErr(`handler:${name}`, e.message);
      }
    }

    logInfo('HANDLERS', '--- Trying different message type formats ---');

    // Try different message formats through evenAppMessage handler
    const messageFormats = [
      { type: 'call_even_app_method', method: 'startEvenAI', data: {} },
      { type: 'call_even_app_method', method: 'sendEvenAIData', data: { text: 'test', newScreen: 0x51, pos: 0, current_page_num: 1, max_page_num: 1 } },
      { type: 'ble_command', method: 'sendData', data: { cmd: 0x4E, payload: 'test' } },
      { type: 'ble', method: 'send', data: { command: 0xF5, subCommand: 0x01 } },
      { type: 'native', method: 'startEvenAI' },
      { type: 'invoke', method: 'startEvenAI' },
      { type: 'method_call', method: 'startEvenAI' },
      { action: 'startEvenAI' },
      { cmd: 'startEvenAI' },
      { type: 'call_even_app_method', method: 'audioControl', data: { isOpen: false } },
    ];

    for (const msg of messageFormats) {
      try {
        const result = await Promise.race([
          callHandler.call(win.flutter_inappwebview, 'evenAppMessage', msg),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 3s')), 3000)),
        ]);
        const label = `${(msg as any).type ?? (msg as any).action ?? (msg as any).cmd}:${(msg as any).method ?? ''}`;
        if (result !== null && result !== undefined) {
          logOk(label, JSON.stringify(result)?.slice(0, 300) ?? 'undefined');
        } else {
          logErr(label, 'null');
        }
      } catch (e: any) {
        const label = `${(msg as any).type ?? (msg as any).action ?? (msg as any).cmd}:${(msg as any).method ?? ''}`;
        logErr(label, e.message);
      }
    }

    logInfo('HANDLERS', '--- Trying _listenEvenAppMessage ---');
    if (win._listenEvenAppMessage) {
      logOk('_listenEvenAppMessage', `exists, type: ${typeof win._listenEvenAppMessage}`);
      // Try calling it with test data to see what it does
      try {
        const result = win._listenEvenAppMessage(JSON.stringify({
          type: 'listen_even_app_data',
          method: 'deviceStatusChanged',
          data: {},
        }));
        logOk('_listenEvenAppMessage call', JSON.stringify(result)?.slice(0, 300) ?? 'undefined');
      } catch (e: any) {
        logErr('_listenEvenAppMessage call', e.message);
      }
    }

    logInfo('HANDLERS', '--- Trying numeric handler IDs ---');
    for (const key of fkeys.filter(k => /^\d+$/.test(k))) {
      try {
        const handler = win.flutter_inappwebview[key];
        logInfo(`key:${key}`, `type=${typeof handler}, value=${JSON.stringify(handler)?.slice(0, 200) ?? String(handler)}`);
      } catch (e: any) {
        logErr(`key:${key}`, e.message);
      }
    }
  };

  // ── Trigger Even AI from WebView ──
  const triggerEvenAI = async () => {
    const win = window as any;
    const bridge = win.EvenAppBridge;
    const callHandler = win.flutter_inappwebview?.callHandler;

    logInfo('EVENAI', '--- Attempting to trigger Even AI ---');

    // Strategy 1: callEvenApp (returns null but might still trigger natively)
    if (bridge?.callEvenApp) {
      try {
        const r = await bridge.callEvenApp('startEvenAI');
        logInfo('callEvenApp:startEvenAI', `returned: ${JSON.stringify(r)}`);
      } catch (e: any) {
        logErr('callEvenApp:startEvenAI', e.message);
      }
    }

    // Wait and watch for events
    logInfo('EVENAI', 'Waiting 5s for events...');
    await new Promise(r => setTimeout(r, 5000));
    logInfo('EVENAI', 'Done waiting. Check events above.');
  };

  // Try multiple Even AI trigger strategies one at a time
  const triggerEvenAIAll = async () => {
    const win = window as any;
    const bridge = win.EvenAppBridge;
    const callHandler = win.flutter_inappwebview?.callHandler;

    logInfo('EVENAI', '--- Trying ALL Even AI trigger methods ---');

    const strategies: Array<{ label: string; fn: () => Promise<any> }> = [];

    if (bridge?.callEvenApp) {
      strategies.push(
        { label: 'callEvenApp:startEvenAI', fn: () => bridge.callEvenApp('startEvenAI') },
        { label: 'callEvenApp:startEvenAI({})', fn: () => bridge.callEvenApp('startEvenAI', {}) },
        { label: 'callEvenApp:startEvenAI(true)', fn: () => bridge.callEvenApp('startEvenAI', true) },
        { label: 'callEvenApp:openEvenAI', fn: () => bridge.callEvenApp('openEvenAI') },
        { label: 'callEvenApp:triggerEvenAI', fn: () => bridge.callEvenApp('triggerEvenAI') },
        { label: 'callEvenApp:launchEvenAI', fn: () => bridge.callEvenApp('launchEvenAI') },
        { label: 'callEvenApp:activateEvenAI', fn: () => bridge.callEvenApp('activateEvenAI') },
        { label: 'callEvenApp:evenAIStart', fn: () => bridge.callEvenApp('evenAIStart') },
        { label: 'callEvenApp:startAI', fn: () => bridge.callEvenApp('startAI') },
        { label: 'callEvenApp:startVoice', fn: () => bridge.callEvenApp('startVoice') },
        { label: 'callEvenApp:startRecording', fn: () => bridge.callEvenApp('startRecording') },
        { label: 'callEvenApp:startSpeech', fn: () => bridge.callEvenApp('startSpeech') },
        { label: 'callEvenApp:startListening', fn: () => bridge.callEvenApp('startListening') },
      );
    }

    if (callHandler) {
      // Try sending native method channel calls directly
      strategies.push(
        {
          label: 'callHandler:startEvenAI',
          fn: () => callHandler.call(win.flutter_inappwebview, 'evenAppMessage',
            JSON.stringify({ type: 'call_even_app_method', method: 'startEvenAI', data: {} })),
        },
        {
          label: 'callHandler:startEvenAI(stringified)',
          fn: () => callHandler.call(win.flutter_inappwebview, 'evenAppMessage',
            { type: 'call_even_app_method', method: 'startEvenAI', data: {} }),
        },
        {
          label: 'callHandler:audioControl(open)',
          fn: () => callHandler.call(win.flutter_inappwebview, 'evenAppMessage',
            JSON.stringify({ type: 'call_even_app_method', method: 'audioControl', data: { isOpen: true } })),
        },
      );
    }

    for (const s of strategies) {
      try {
        const result = await Promise.race([
          s.fn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
        if (result !== null && result !== undefined) {
          logOk(s.label, JSON.stringify(result));
        } else {
          logInfo(s.label, `${result}`);
        }
      } catch (e: any) {
        logErr(s.label, e.message);
      }
      // Small delay between attempts to see individual effects
      await new Promise(r => setTimeout(r, 500));
    }

    logInfo('EVENAI', '--- All attempts done. Check events above. ---');
  };

  // ── Test mic + audio capture ──
  const testMicCapture = async () => {
    const win = window as any;
    const bridge = win.EvenAppBridge;
    if (!bridge) {
      logErr('MIC', 'EvenAppBridge not found');
      return;
    }

    logInfo('MIC', '--- Opening mic and listening for audio data ---');

    // Register audio event listener
    let audioChunks = 0;
    let totalBytes = 0;
    const unsub = bridge.onEvenHubEvent((event: any) => {
      const str = JSON.stringify(event)?.slice(0, 300) ?? '';
      if (event.audioEvent || str.includes('audio')) {
        audioChunks++;
        const pcm = event.audioEvent?.audioPcm;
        const size = pcm?.length ?? pcm?.byteLength ?? 0;
        totalBytes += size;
        setLogs(prev => [...prev, {
          ts: now(), tag: `AUDIO #${audioChunks}`, color: '#22d3ee',
          message: `${size} bytes (total: ${totalBytes})`,
        }]);
      } else {
        setLogs(prev => [...prev, {
          ts: now(), tag: 'EVENT', color: '#a78bfa',
          message: str,
        }]);
      }
    });

    // Open mic
    try {
      const result = await bridge.callEvenApp('audioControl', { isOpen: true });
      logOk('MIC', `audioControl(open) returned: ${result}`);
    } catch (e: any) {
      logErr('MIC', `audioControl failed: ${e.message}`);
      return;
    }

    logInfo('MIC', 'Mic opened. Speak now! Listening for 10 seconds...');

    // Wait 10 seconds
    await new Promise(r => setTimeout(r, 10000));

    // Close mic
    try {
      await bridge.callEvenApp('audioControl', { isOpen: false });
      logInfo('MIC', 'Mic closed');
    } catch { /* ignore */ }

    logInfo('MIC', `Result: ${audioChunks} audio chunks, ${totalBytes} total bytes`);
    if (audioChunks === 0) {
      logErr('MIC', 'No audio data received. Mic may not have actually opened.');
    } else {
      logOk('MIC', 'Audio capture works! We can build the voice pipeline.');
    }
  };

  // ── Deep inspect bridge ──
  const deepInspect = async () => {
    const win = window as any;
    const bridge = win.EvenAppBridge;
    if (!bridge) {
      logErr('DEEP', 'EvenAppBridge not found');
      return;
    }

    logInfo('DEEP', '--- Deep inspecting EvenAppBridge ---');

    // Check _ready state
    logInfo('DEEP', `bridge._ready = ${bridge._ready}`);
    logInfo('DEEP', `bridge.ready = ${bridge.ready}`);

    // Check if postMessage is accessible and what it does
    if (bridge.postMessage) {
      logOk('DEEP', 'bridge.postMessage exists');
      // Intercept postMessage to see raw protocol
      const origPost = bridge.postMessage.bind(bridge);
      bridge.postMessage = async function(msg: any) {
        setLogs(prev => [...prev, {
          ts: now(), tag: 'RAW:postMessage', color: '#f59e0b',
          message: JSON.stringify(msg)?.slice(0, 500) ?? 'undefined',
        }]);
        const result = await origPost(msg);
        setLogs(prev => [...prev, {
          ts: now(), tag: 'RAW:postResult', color: '#f97316',
          message: JSON.stringify(result)?.slice(0, 500) ?? 'undefined',
        }]);
        return result;
      };
      logOk('DEEP', 'postMessage intercepted — all future bridge calls will show raw protocol');
    } else {
      logErr('DEEP', 'bridge.postMessage not accessible (private)');
    }

    // Try documented methods and show exact return values
    logInfo('DEEP', '--- Testing documented methods ---');
    for (const method of ['getUserInfo', 'getDeviceInfo', 'getGlassesInfo', 'audioControl', 'getLocalStorage', 'shutDownPageContainer']) {
      try {
        let result;
        if (method === 'getLocalStorage') {
          result = await bridge.callEvenApp('getLocalStorage', { key: 'test' });
        } else if (method === 'audioControl') {
          // Don't actually open mic, just test with false
          result = await bridge.callEvenApp('audioControl', { isOpen: false });
        } else if (method === 'shutDownPageContainer') {
          // Skip — don't want to close the app
          logInfo(method, '(skipped — would close app)');
          continue;
        } else {
          result = await bridge.callEvenApp(method);
        }
        logOk(method, `type=${typeof result} val=${JSON.stringify(result)}`);
      } catch (e: any) {
        logErr(method, e.message);
      }
    }

    // Try a definitely-fake method to see if null is the "not found" response
    logInfo('DEEP', '--- Testing fake method ---');
    try {
      const fake = await bridge.callEvenApp('thisMethodDefinitelyDoesNotExist12345');
      logInfo('fakeMethod', `returned: ${JSON.stringify(fake)} (type: ${typeof fake})`);
    } catch (e: any) {
      logErr('fakeMethod', `threw: ${e.message}`);
    }

    // Check __evenBetterSdkSharedState
    if (win.__evenBetterSdkSharedState) {
      logOk('DEEP', `__evenBetterSdkSharedState: ${JSON.stringify(Object.keys(win.__evenBetterSdkSharedState))}`);
    }
  };

  // ── Render ──
  const s = {
    btn: { padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const,
    input: { flex: 1, background: '#222', border: '1px solid #555', borderRadius: 6, padding: '8px 10px', color: '#eee', fontSize: 13 } as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a', color: '#eee', fontFamily: 'system-ui' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #333', fontSize: 18, fontWeight: 700 }}>
        Bridge Probe
      </div>

      <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #333' }}>
        <button style={{ ...s.btn, background: '#2563eb', color: '#fff' }} onClick={inspectWindow}>
          Inspect Window
        </button>
        <button style={{ ...s.btn, background: '#059669', color: '#fff' }} onClick={runProbe} disabled={running}>
          {running ? 'Probing...' : 'Probe Methods'}
        </button>
        <button style={{ ...s.btn, background: '#7c3aed', color: '#fff' }} onClick={installInterceptor}>
          Interceptor
        </button>
        <button style={{ ...s.btn, background: '#d97706', color: '#fff' }} onClick={deepInspect}>
          Deep Inspect
        </button>
        <button style={{ ...s.btn, background: '#0891b2', color: '#fff' }} onClick={probeHandlers}>
          Probe Handlers
        </button>
        <button style={{ ...s.btn, background: '#e11d48', color: '#fff' }} onClick={triggerEvenAI}>
          Trigger Even AI
        </button>
        <button style={{ ...s.btn, background: '#be123c', color: '#fff' }} onClick={triggerEvenAIAll}>
          Try ALL Triggers
        </button>
        <button style={{ ...s.btn, background: '#16a34a', color: '#fff' }} onClick={testMicCapture}>
          Test Mic (10s)
        </button>
        <button style={{ ...s.btn, background: '#dc2626', color: '#fff' }} onClick={() => setLogs([])}>
          Clear
        </button>
      </div>

      <div style={{ padding: '8px 16px', display: 'flex', gap: 8, borderBottom: '1px solid #333' }}>
        <input
          style={s.input}
          placeholder="Method name"
          value={customMethod}
          onChange={(e) => setCustomMethod(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runCustom()}
        />
        <input
          style={s.input}
          placeholder='JSON params'
          value={customParams}
          onChange={(e) => setCustomParams(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runCustom()}
        />
        <button style={{ ...s.btn, background: '#2563eb', color: '#fff' }} onClick={runCustom}>Call</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
        {logs.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', paddingTop: 40, fontSize: 14 }}>
            Tap "Inspect Window" first to see what bridge objects are available.
          </div>
        )}
        {logs.map((entry, i) => (
          <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid #1a1a1a', color: entry.color }}>
            <span style={{ color: '#666' }}>{entry.ts} </span>
            <strong>{entry.tag}</strong>
            {' '}
            <span style={{ wordBreak: 'break-all' }}>{entry.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
