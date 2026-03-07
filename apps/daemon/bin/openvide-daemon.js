#!/usr/bin/env node

// Entry point — delegates to compiled CLI
// If invoked with --daemon-main, the daemon.js module handles it directly
// via its top-level check. Otherwise, cli.js handles subcommand routing.

import "../dist/cli.js";
