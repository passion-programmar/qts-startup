// tsx asks Node for the current OS user while creating its temporary directory.
// Some Windows/Node combinations fail that lookup even when USERNAME is set.
if (typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => process.env.USERNAME || 'qts',
  });
}
