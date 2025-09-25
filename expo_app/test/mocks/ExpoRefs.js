module.exports = {
  createSnapshotFriendlyRef: () => {
    const ref = { current: null };
    Object.defineProperty(ref, 'toJSON', {
      value: () => '[React.ref]',
    });
    return ref;
  },
};


