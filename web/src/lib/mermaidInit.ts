let loader: Promise<typeof import('mermaid')['default']> | undefined;

export function initMermaid() {
  loader ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
    return mermaid;
  }).catch(error => { loader = undefined; throw error; });
  return loader;
}
