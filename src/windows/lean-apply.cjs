// bun -e eval mode: argv[1]=lean-mode.cjs path, argv[2]=settings, argv[3]=patches.
// require in eval mode resolves from CWD, so lean-mode must be loaded by absolute path.
require(process.argv[1]).leanApply(process.argv[2], undefined, process.argv[3]);
