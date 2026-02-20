export const REQUIRED_DAEMON_VERSION = "0.1.1";

export interface DaemonCompatibility {
  compatible: boolean;
  reason?: string;
}

function parseSemver(version: string): [number, number, number] | undefined {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ];
}

function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return Number.NaN;

  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  return left[2] - right[2];
}

export function evaluateDaemonCompatibility(
  installed: boolean,
  version?: string,
): DaemonCompatibility {
  if (!installed) {
    return {
      compatible: false,
      reason: "openvide-daemon is not installed on this host.",
    };
  }

  if (!version) {
    return {
      compatible: false,
      reason: `openvide-daemon version is unknown. Required version is ${REQUIRED_DAEMON_VERSION} or newer.`,
    };
  }

  const cmp = compareSemver(version, REQUIRED_DAEMON_VERSION);
  if (Number.isNaN(cmp)) {
    return {
      compatible: false,
      reason: `openvide-daemon version '${version}' is not a supported semver string. Required version is ${REQUIRED_DAEMON_VERSION} or newer.`,
    };
  }

  if (cmp < 0) {
    return {
      compatible: false,
      reason: `openvide-daemon ${version} is too old. Required version is ${REQUIRED_DAEMON_VERSION} or newer.`,
    };
  }

  return { compatible: true };
}
