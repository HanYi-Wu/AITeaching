import { Component, type ReactNode } from 'react';

/** A failed lazy chunk must not tear down the navigation shell. */
export class WorkspaceLoadBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey?: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <h2 className="font-semibold">此工作区暂时无法加载</h2>
      <p className="text-slate-600">请检查网络。可以切换其他页面，或重新加载最新版本。</p>
      <p className="text-xs text-amber-700">重新加载前，请留意尚未保存的编辑。</p>
      <button type="button" className="rounded bg-slate-900 px-3 py-2 text-white" onClick={() => window.location.reload()}>重新加载</button>
    </section>;
  }
}
