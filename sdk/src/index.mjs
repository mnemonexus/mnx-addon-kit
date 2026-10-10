/** Access the protocol-v1 host supplied before an add-on's bundle starts. */
export function getExperienceHost(scope = globalThis) {
  const host = scope.mnx;
  if (!host || host.protocolVersion !== 1 || host.props?.kind !== 'experience' ||
      typeof host.props.extensionId !== 'string' ||
      !['standalone', 'recall', 'transferal', 'calendar', 'study'].includes(host.props.surface) ||
      !Array.isArray(host.props.items) || !Array.isArray(host.props.permissions) ||
      !host.root || typeof host.complete !== 'function' || typeof host.exit !== 'function') {
    throw new Error('Launch this add-on through a compatible MnemoNexus Experience host (protocol 1).');
  }
  if (host.props.surface === 'study' &&
      (!host.capabilities?.includes('study-examples-v1') || !host.capabilities?.includes('study-storage-v1') ||
       host.props.study?.version !== 1 || typeof host.props.study.runId !== 'string' ||
       typeof host.props.study.taskId !== 'string' || typeof host.props.study.contextFingerprint !== 'string')) {
    throw new Error('Launch this add-on through a compatible study Experience host.');
  }
  return host;
}
