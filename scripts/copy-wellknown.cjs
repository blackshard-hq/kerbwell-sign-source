#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');

const wellKnownPath = path.join(__dirname, '../.well-known');

// security.txt is served by the app router from the instance brand (apps/remix/server/api/brand),
// so the repo keeps no static copy; with nothing here there is nothing to copy.
if (!fs.existsSync(wellKnownPath)) {
  console.log('No .well-known/ contents to copy');
  process.exit(0);
}

console.log('Copying .well-known/ contents to apps');
fs.cpSync(wellKnownPath, path.join(__dirname, '../apps/remix/public/.well-known'), {
  recursive: true,
});
