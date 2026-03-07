const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function writeIfChanged(targetPath, content) {
  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath, "utf8") === content) {
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function patchAndroidModule(packageRoot) {
  const modulePath = path.join(
    packageRoot,
    "android/src/main/java/me/keeex/rnssh/RNSshClientModule.java",
  );
  if (!fs.existsSync(modulePath)) {
    return;
  }

  let source = fs.readFileSync(modulePath, "utf8");

  if (!source.includes("Map<String, Integer> _localPortForwards = new HashMap<>();")) {
    source = source.replace(
      "    Boolean _uploadContinue = false;\n",
      "    Boolean _uploadContinue = false;\n    Map<String, Integer> _localPortForwards = new HashMap<>();\n",
    );
  }

  if (!source.includes("client._localPortForwards.clear();")) {
    source = source.replace(
      "    if (client != null) {\n        client._session.disconnect();\n    }\n",
      "    if (client != null) {\n        client._localPortForwards.clear();\n        client._session.disconnect();\n    }\n",
    );
  }

  if (!source.includes("public void startLocalPortForward(")) {
    const insertionPoint = "  private class progressMonitor implements SftpProgressMonitor {\n";
    const methods = `

  @ReactMethod
  public void startLocalPortForward(
    final String remoteHost,
    final Integer remotePort,
    final String localHost,
    final Integer localPort,
    final String key,
    final Callback callback
  ) {
    new Thread(new Runnable() {
      public void run() {
        try {
          SSHClient client = clientPool.get(key);
          if (client == null || client._session == null || !client._session.isConnected()) {
            callback.invoke("Session not connected");
            return;
          }

          int assignedPort = client._session.setPortForwardingL(
            localHost,
            localPort,
            remoteHost,
            remotePort
          );
          String tunnelId = String.format(
            Locale.US,
            "%s:%d->%s:%d",
            localHost,
            assignedPort,
            remoteHost,
            remotePort
          );
          client._localPortForwards.put(tunnelId, assignedPort);

          WritableMap response = Arguments.createMap();
          response.putString("tunnelId", tunnelId);
          response.putString("localHost", localHost);
          response.putInt("localPort", assignedPort);
          response.putString("remoteHost", remoteHost);
          response.putInt("remotePort", remotePort);
          callback.invoke(null, response);
        } catch (Exception error) {
          Log.e(LOGTAG, "Error starting local port forward: " + error.getMessage());
          callback.invoke(error.getMessage());
        }
      }
    }).start();
  }

  @ReactMethod
  public void stopLocalPortForward(
    final String tunnelId,
    final String key,
    final Callback callback
  ) {
    new Thread(new Runnable() {
      public void run() {
        try {
          SSHClient client = clientPool.get(key);
          if (client == null || client._session == null || !client._session.isConnected()) {
            callback.invoke("Session not connected");
            return;
          }

          Integer localPort = client._localPortForwards.remove(tunnelId);
          if (localPort == null) {
            callback.invoke();
            return;
          }

          client._session.delPortForwardingL(localPort);
          callback.invoke();
        } catch (Exception error) {
          Log.e(LOGTAG, "Error stopping local port forward: " + error.getMessage());
          callback.invoke(error.getMessage());
        }
      }
    }).start();
  }
`;
    source = source.replace(insertionPoint, `${methods}\n${insertionPoint}`);
  }

  fs.writeFileSync(modulePath, source, "utf8");
}

function patchIosModule(packageRoot, pluginDir) {
  const iosDir = path.join(packageRoot, "ios");
  const rnModulePath = path.join(iosDir, "RNSSHClient.m");
  if (!fs.existsSync(rnModulePath)) {
    return;
  }

  writeIfChanged(
    path.join(iosDir, "SSHLocalPortForward.h"),
    fs.readFileSync(path.join(pluginDir, "ssh-port-forwarding/SSHLocalPortForward.h"), "utf8"),
  );
  writeIfChanged(
    path.join(iosDir, "SSHLocalPortForward.m"),
    fs.readFileSync(path.join(pluginDir, "ssh-port-forwarding/SSHLocalPortForward.m"), "utf8"),
  );

  let source = fs.readFileSync(rnModulePath, "utf8");

  if (!source.includes('#import "SSHLocalPortForward.h"')) {
    source = source.replace(
      '#import "SSHClient.h"\n',
      '#import "SSHClient.h"\n#import "SSHLocalPortForward.h"\n',
    );
  }

  if (!source.includes("NSMutableDictionary* _forwardPool;")) {
    source = source.replace(
      "@implementation RNSSHClient {\n    NSMutableDictionary* _clientPool;\n}\n",
      "@implementation RNSSHClient {\n    NSMutableDictionary* _clientPool;\n    NSMutableDictionary* _forwardPool;\n}\n",
    );
  }

  if (!source.includes("- (NSMutableDictionary*) forwardPool")) {
    const insertionPoint = "- (BOOL)isConnected:(NMSSHSession *)session\n";
    const helpers = `
- (NSMutableDictionary*) forwardPool {
    if (!_forwardPool) {
        _forwardPool = [NSMutableDictionary new];
    }
    return _forwardPool;
}

- (NSMutableDictionary*) forwardPoolForKey:(nonnull NSString*)key {
    NSMutableDictionary *forwards = [[self forwardPool] objectForKey:key];
    if (!forwards) {
        forwards = [NSMutableDictionary new];
        [[self forwardPool] setObject:forwards forKey:key];
    }
    return forwards;
}

- (void)stopAllLocalPortForwardsForKey:(nonnull NSString*)key {
    NSMutableDictionary *forwards = [[self forwardPool] objectForKey:key];
    for (NSString *tunnelId in [forwards allKeys]) {
        SSHLocalPortForward *forward = [forwards objectForKey:tunnelId];
        [forward stop];
    }
    [[self forwardPool] removeObjectForKey:key];
}

`;
    source = source.replace(insertionPoint, `${helpers}${insertionPoint}`);
  }

  if (!source.includes("RCT_EXPORT_METHOD(startLocalPortForward:")) {
    const insertionPoint = "RCT_EXPORT_METHOD(connectSFTP:(nonnull NSString*)key\n";
    const methods = `
RCT_EXPORT_METHOD(startLocalPortForward:(NSString *)remoteHost
                  remotePort:(NSInteger)remotePort
                  localHost:(NSString *)localHost
                  localPort:(NSInteger)localPort
                  withKey:(nonnull NSString*)key
                  withCallback:(RCTResponseSenderBlock)callback) {
    SSHClient* client = [self clientForKey:key];
    if (!client) {
        callback(@[@"Unknown client"]);
        return;
    }

    NSError *error = nil;
    SSHLocalPortForward *forward = [[SSHLocalPortForward alloc] initWithClient:client
                                                                    remoteHost:remoteHost
                                                                    remotePort:remotePort
                                                                     localHost:localHost
                                                                     localPort:localPort];
    BOOL started = [forward start:&error];
    if (!started || error) {
        callback(@[error ? RCTJSErrorFromNSError(error) : @"Failed to start local port forward"]);
        return;
    }

    NSMutableDictionary *forwards = [self forwardPoolForKey:key];
    [forwards setObject:forward forKey:forward.tunnelId];
    callback(@[
        [NSNull null],
        @{
            @"tunnelId": forward.tunnelId,
            @"localHost": forward.localHost,
            @"localPort": @(forward.localPort),
            @"remoteHost": forward.remoteHost,
            @"remotePort": @(forward.remotePort),
        },
    ]);
}

RCT_EXPORT_METHOD(stopLocalPortForward:(NSString *)tunnelId
                  withKey:(nonnull NSString*)key
                  withCallback:(RCTResponseSenderBlock)callback) {
    NSMutableDictionary *forwards = [self forwardPoolForKey:key];
    SSHLocalPortForward *forward = [forwards objectForKey:tunnelId];
    if (forward) {
        [forward stop];
        [forwards removeObjectForKey:tunnelId];
    }
    callback(@[]);
}

`;
    source = source.replace(insertionPoint, `${methods}${insertionPoint}`);
  }

  if (!source.includes("[self stopAllLocalPortForwardsForKey:key];")) {
    source = source.replace(
      "RCT_EXPORT_METHOD(disconnect:(nonnull NSString*)key) {\n    [self closeShell:key];\n    [self disconnectSFTP:key];\n",
      "RCT_EXPORT_METHOD(disconnect:(nonnull NSString*)key) {\n    [self closeShell:key];\n    [self disconnectSFTP:key];\n    [self stopAllLocalPortForwardsForKey:key];\n",
    );
  }

  fs.writeFileSync(rnModulePath, source, "utf8");
}

function withSshPortForwarding(config) {
  const patch = async (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const pluginDir = path.join(projectRoot, "plugins");
    const packageRoot = path.join(projectRoot, "node_modules/@dylankenneally/react-native-ssh-sftp");
    if (!fs.existsSync(packageRoot)) {
      return mod;
    }

    patchAndroidModule(packageRoot);
    patchIosModule(packageRoot, pluginDir);
    console.log("[withSshPortForwarding] Patched react-native-ssh-sftp with local port forwarding");
    return mod;
  };

  config = withDangerousMod(config, ["ios", patch]);
  config = withDangerousMod(config, ["android", patch]);
  return config;
}

module.exports = withSshPortForwarding;
