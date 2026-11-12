const { existsSync } = require('fs');
const { dirname, join } = require('path');
const local = join(dirname(process.argv[1]), 'lean-mode.cjs');
require(existsSync(local) ? local : './lean-mode.cjs').leanApply(process.argv[1], undefined, process.argv[2]);
