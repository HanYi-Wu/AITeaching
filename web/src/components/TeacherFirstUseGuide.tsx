import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, X } from 'lucide-react';
import { apiPost } from '../api/client';
import { updateAccountCredentials, type PlatformUser } from '../platform/auth';
import type { AppPage } from '../app/appPages';
import '../ui-redesign/g55/g55.css';

const steps: { page: AppPage; title: string; text: string }[] = [
  { page: 'settings', title: '设置学科与个人资料', text: '在个性化设置中确认学科、头像和显示方式。多个学科发布时需要选择；已有学科可以保持不变。' },
  { page: 'bank', title: '准备题目与答案', text: '新建或导入题目，检查题干、选项、参考答案和分值。文件夹支持拖动、剪切、子目录和CDK分享；多个答案用“或”，同时要求用“且”。不会改动已发布的历史快照。' },
  { page: 'template', title: '选择卷面模板', text: '浏览可用模板，确认小节题型、数量和分值；模板控制卷面结构。需要时新建或调整模板，也可以让助手创建。' },
  { page: 'compose', title: '组卷并校验', text: '选择模板和题目、设置分值，保存草稿后校验预览。检查公式、图片、选项及卷面总分；未准备好时不必为了引导创建真实试卷。' },
  { page: 'papers', title: '发布与批改', text: '选择班级、学科、提交方式和起止时间，再发布。全选择题网页答卷提交后直接出成绩；混合题和图片答卷需要批改、确认发布。批改时对照学生答案与冻结参考答案。' },
  { page: 'students', title: '查看学生状态', text: '使用班级、学生和时间筛选查看学习情况。统计仅来自你发布的试卷；无答卷时显示缺少数据，不会生成虚构成绩。' },
  { page: 'analysis', title: '查看分析与后续练习', text: '选择真实考试记录，查看错题和知识点分析；需要时发布历史错题卷或专项复习卷。检查分析所依据的试卷和时间范围。' },
  { page: 'papers', title: '同一套流程也能交给AI', text: '点击“打开AI助手”，可描述“整理题目→创建模板→组卷→发布→批改建议→学生分析”。助手调用真实工具，需要的数据缺失时会提示；写入和发布需确认，高风险操作由你核实。AI配置、可用班级及真实答卷仍是前提。' },
];

export function TeacherFirstUseGuide({
  user,
  onUpdated,
  onNavigate,
  onOpenAssistant,
}: {
  user: PlatformUser;
  onUpdated: (user: PlatformUser) => void;
  onNavigate: (page: AppPage) => void;
  onOpenAssistant: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const step = user.teacher_guide_step ?? 0;
  const requiredPassword = Boolean(user.must_change_password);

  useEffect(() => {
    setAcknowledged(false);
    if (!requiredPassword && step < steps.length) onNavigate(steps[step].page);
  }, [user.id, step, requiredPassword, onNavigate]);

  useEffect(() => {
    const replay = async () => {
      try {
        const result = await apiPost<{ user: PlatformUser }>('/api/auth/teacher-guide', { step: 0 });
        onUpdated(result.user);
        setDismissed(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    window.addEventListener('eh-replay-teacher-guide', replay);
    return () => window.removeEventListener('eh-replay-teacher-guide', replay);
  }, [onUpdated]);

  async function changePassword() {
    if (password.length < 6 || password !== confirmation || password === currentPassword) {
      setError('新密码至少6位、两次一致，且不能与初始密码相同');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateAccountCredentials({
        current_password: currentPassword,
        new_password: password,
      });
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
      onUpdated(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<{ user: PlatformUser }>('/api/auth/teacher-guide', { step: step + 1 });
      onUpdated(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function dismissForever() {
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<{ user: PlatformUser }>('/api/auth/teacher-guide', { step: steps.length });
      setDismissed(true);
      onUpdated(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (requiredPassword) {
    return (
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby="first-password-help"
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="fixed left-1/2 top-1/2 z-[81] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-5 sm:p-6 shadow-2xl  "
          >
            <div>
              <Dialog.Title className="text-base sm:text-lg font-bold text-[var(--or-text)] ">
                首次登录：修改初始密码
              </Dialog.Title>
              <Dialog.Description id="first-password-help" className="mt-1 text-xs sm:text-sm text-[var(--or-muted)] ">
                为保护你的题库和学生资料，请先修改学校分配的初始密码，随后进入完整使用引导。
              </Dialog.Description>
            </div>
            <form
              className="space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                void changePassword();
              }}
            >
              <div>
                <label className="block text-sm font-medium text-[var(--or-muted)] ">
                  初始密码
                  <input
                    aria-label="初始密码"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-[16px] sm:text-sm text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus   "
                    required
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--or-muted)] ">
                  新密码
                  <input
                    aria-label="新密码"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-[16px] sm:text-sm text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus   "
                    required
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--or-muted)] ">
                  确认新密码
                  <input
                    aria-label="确认新密码"
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-[var(--or-outline)] bg-[var(--or-card)] px-3 py-2 text-[16px] sm:text-sm text-[var(--or-text)] outline-none transition focus:border-or-focus focus:ring-2 focus:ring-or-focus   "
                    required
                  />
                </label>
              </div>
              {error ? (
                <p role="alert" className="or-g55-error-surface rounded-lg p-2.5 text-xs font-medium">
                  {error}
                </p>
              ) : null}
              <button
                disabled={busy}
                className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg bg-or-primary px-4 text-sm font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-50"
              >
                修改密码并进入引导
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (step >= steps.length) return null;
  if (dismissed) return null;

  return (
    <section
      aria-label="教师使用引导"
      className="or-g55-guide mx-3 mt-2 w-[calc(100%-1.5rem)] shrink-0 space-y-3 rounded-2xl border border-[var(--or-outline)] bg-[var(--or-card)] p-3 shadow-sm sm:mx-4 sm:w-[calc(100%-2rem)] sm:p-4"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--or-outline)] pb-2">
        <h2 className="min-w-0 truncate text-sm font-bold text-[var(--or-text)]">
          使用引导 {step + 1}/{steps.length} · {steps[step].title}
        </h2>
        <button
          type="button"
          disabled={busy}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--or-error)_28%,transparent)] bg-[color-mix(in_srgb,var(--or-error)_12%,transparent)] px-3 text-xs font-medium text-[var(--or-error)] transition hover:bg-[color-mix(in_srgb,var(--or-error)_20%,transparent)] disabled:opacity-40"
          onClick={() => void dismissForever()}
        >
          不再提示
        </button>
        <button
          type="button"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--or-muted)] hover:bg-[var(--or-block)]"
          aria-label="稍后继续使用引导"
          title="稍后继续"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span>稍后继续</span>
        </button>
      </div>
      <div className="or-g55-guide-content">
        <div className="space-y-3">
            <p className="text-sm leading-relaxed text-[var(--or-muted)]">{steps[step].text}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--or-outline)] bg-[var(--or-page)] px-3 text-xs font-medium text-[var(--or-muted)] transition hover:bg-[var(--or-block)]"
                onClick={() => onNavigate(steps[step].page)}
              >
                进入对应页面
              </button>
              {step === steps.length - 1 ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-or-primary-container px-3 text-xs font-semibold text-or-on-container transition hover:brightness-95"
                  onClick={onOpenAssistant}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  打开AI助手
                </button>
              ) : null}
            </div>
            <label className="flex items-center gap-2 pt-1 text-xs text-[var(--or-muted)]">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="rounded border-[var(--or-outline)] text-or-primary focus:ring-or-focus"
              />
              <span>我已查看页面并了解此步骤（不代表已发布或产生数据）</span>
            </label>
            {error ? (
              <p role="alert" className="text-xs text-or-error">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy || !acknowledged}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-or-primary px-4 text-xs font-semibold text-or-on-primary shadow-sm transition hover:brightness-95 disabled:opacity-40"
              onClick={() => void next()}
            >
              {step === steps.length - 1 ? '完成引导' : '下一步'}
            </button>
        </div>
      </div>
    </section>
  );
}
