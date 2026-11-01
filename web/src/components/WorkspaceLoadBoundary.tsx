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
    return (
      <section
        role="alert"
        className="flex h-full min-h-[260px] flex-col items-center justify-center p-6 text-center text-sm"
      >
        <div className="w-full max-w-md rounded-[16px] border border-[var(--or-outline)] bg-[var(--or-card)] p-6 shadow-sm">
          <h2 className="text-base font-semibold text-[var(--or-text)]">此工作区暂时无法加载</h2>
          <p className="mt-2 text-sm text-[var(--or-muted)] leading-relaxed">
            请检查网络。可以切换其他页面，或重新加载最新版本。
          </p>
          <p className="mt-2 text-xs sm:text-sm text-[var(--or-on-warning)] dark:text-[var(--or-on-warning)]">
            重新加载前，请留意尚未保存的编辑。
          </p>
          <button
            type="button"
            className="or-button or-button-primary mt-5 rounded-[10px] px-4 py-2 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </section>
    );
  }
}
