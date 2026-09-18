import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { apiGet } from '../api/client';
import { ContentWithPrimeBrush } from './ContentWithPrimeBrush';

type Question = { content: string; answer?: string; options?: Record<string, string>; analysis?: string };
export function QuestionHoverDetails({ id, children }: { id: string; children: ReactNode }) {
  const [detail, setDetail] = useState<Question | null>(null);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(true);
  const loading = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { setDetail(null); setError(''); }, [id]);
  function open() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = host.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - 568, rect.right + 8)), top: Math.max(8, Math.min(window.innerHeight * .3, rect.top)) });
      if (detail || loading.current) return;
      loading.current = true;
      void apiGet<{ question: Question | null; question_display?: Question }>(`/api/bank/items/${encodeURIComponent(id)}`).then(result => {
        if (active.current) { setDetail(result.question_display ?? result.question); setError(result.question_display || result.question ? '' : '请点击打开查看完整材料与子题'); }
      }).catch(() => { if (active.current) setError('详情加载失败，请点击题目重试'); }).finally(() => { loading.current = false; });
    }, 250);
  }
  function close() { clearTimeout(timer.current); timer.current = setTimeout(() => setPosition(null), 150); }
  return <span ref={host} className="block" tabIndex={0} aria-label={`${id} 题目详情`} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
    {children}
    {position ? createPortal(<aside role="tooltip" aria-label="题目完整详情" className="fixed z-[80] max-h-[65vh] w-[560px] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border bg-white p-4 text-left text-sm shadow-xl" style={position} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={close}>
      <p className="mb-2 break-all text-xs font-semibold text-slate-500">{id}</p>
      {detail ? <><ContentWithPrimeBrush text={detail.content} />{Object.entries(detail.options ?? {}).map(([key, text]) => <ContentWithPrimeBrush key={key} text={`${key}. ${text}`} className="mt-1" />)}<p className="mt-3 font-semibold">参考答案</p><ContentWithPrimeBrush text={detail.answer ?? '未配置'} /></> : <p>{error || '正在加载题目详情…'}</p>}
    </aside>, document.body) : null}
  </span>;
}
