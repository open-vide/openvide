/// <reference types="nativewind/types" />

// React 19: re-export JSX namespace globally for compat with `: JSX.Element` return types
import type { JSX } from "react";
declare global {
  export { JSX };
}
