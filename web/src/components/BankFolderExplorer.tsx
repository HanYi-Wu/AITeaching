import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import { apiPost } from '../api/client';
import { confirmDialog } from '../lib/confirmDialog';
import { notifyContentLibraryChanged } from '../lib/contentEvents';

export type BankFolders = { folders: string[]; assignments: Record<string, string> };
type Item = { qualified_id: string; content_preview?: string };
const buttonClass = 'rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50';

export function BankFolderExplorer<T extends Item>({ data, items, selectedIds, onChange, onError, renderItem, onSelectIds }: {
  data: BankFolders; items: T[]; selectedIds: string[]; onChange: (data: BankFolders) => void;
  onError: (message: string | null) => void; renderItem: (item: T) => ReactNode;
  onSelectIds?: (ids: string[]) => void;
}) {
  const [selectedFolder, setSelectedFolder] = useState('');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [exploring, setExploring] = useState(false);
  const [rectangle, setRectangle] = useState<{ x: number; y: number; right: number; bottom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; base: string[] } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  function toggleAll(path: string) {
    const ids = items.filter(item => !path || (data.assignments[item.qualified_id] ?? '') === path || (data.assignments[item.qualified_id] ?? '').startsWith(path + '/')).map(item => item.qualified_id);
    onSelectIds?.(ids.every(id => selectedIds.includes(id))
      ? selectedIds.filter(id => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]);
  }
  const index = useMemo(() => {
    const children = new Map<string, string[]>();
    const questions = new Map<string, T[]>();
    const known = new Set(data.folders);
    for (const path of data.folders) {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const group = children.get(parent) ?? [];
      group.push(path);
      children.set(parent, group);
    }
    for (const item of items) {
      const assigned = data.assignments[item.qualified_id] ?? '';
      const path = known.has(assigned) ? assigned : '';
      const group = questions.get(path) ?? [];
      group.push(item);
      questions.set(path, group);
    }
    return { children, questions };
  }, [data, items]);

  async function act(action: string) {
    if (action === 'remove' && !(await confirmDialog('删除此目录及子目录？题目会移到父目录，不会删除题目。'))) return;
    setBusy(true);
    onError(null);
    try {
      const body = action === 'move' ? { action, path: destination, qualified_ids: selectedIds }
        : action === 'create' ? { action, path: name.trim() }
        : { action, path: selectedFolder, target: name.trim() };
      const result = await apiPost<BankFolders>('/api/bank/folders/actions', body);
      onChange(result);
      setSelectedFolder(action === 'remove' ? '' : action === 'create' || action === 'rename' ? name.trim() : selectedFolder);
      setName('');
      if (destination && !result.folders.includes(destination)) setDestination('');
      setMessage(action === 'move' ? `已移动 ${selectedIds.length} 道题目` : '目录已保存');
      notifyContentLibraryChanged('question');
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function branch(path: string): ReactNode {
    return <ul className={path ? 'ml-2 border-l border-slate-200 pl-2' : 'p-2'}>
      {(index.children.get(path) ?? []).map(child => <li key={child}>
        <details open>
          <summary className={`cursor-pointer break-all rounded px-1 py-2 text-sm ${selectedFolder === child ? 'bg-slate-200' : 'hover:bg-slate-100'}`} onClick={() => { setSelectedFolder(child); setName(child); }}>
            <Folder className="mr-1 inline h-4 w-4 text-amber-600" aria-hidden />{child.split('/').at(-1)}
            {onSelectIds ? <button type="button" className="ml-2 rounded border px-1 text-xs" onClick={event => { event.preventDefault(); event.stopPropagation(); toggleAll(child); }}>全选 / 取消</button> : null}
          </summary>
          {branch(child)}
        </details>
      </li>)}
      {(index.questions.get(path) ?? []).map(renderItem)}
    </ul>;
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="space-y-2 border-b p-2">
      <p className="break-all text-xs text-slate-500">当前目录：{selectedFolder || '根目录（未分组）'}</p>
      <label className="block text-xs">目录名称 / 子目录路径<input aria-label="目录路径" value={name} onChange={e => setName(e.target.value)} placeholder="数学/函数" className="mt-1 w-full rounded border px-2 py-1.5" /></label>
      <div className="flex flex-wrap gap-1">
        {onSelectIds ? <button type="button" className={buttonClass} onClick={() => toggleAll('')}>全选 / 取消全选</button> : null}
        {onSelectIds ? <button type="button" className={buttonClass} onClick={() => setExploring(true)}>打开文件管理器</button> : null}
        <button type="button" className={buttonClass} disabled={busy || !name.trim()} onClick={() => void act('create')}>新建目录</button>
        <button type="button" className={buttonClass} disabled={busy || !selectedFolder || !name.trim()} onClick={() => void act('rename')}>重命名</button>
        <button type="button" className={buttonClass} disabled={busy || !selectedFolder} onClick={() => void act('remove')}>删除目录</button>
      </div>
      <select aria-label="移动到目录" value={destination} onChange={e => setDestination(e.target.value)} className="w-full rounded border px-2 py-1.5 text-xs"><option value="">根目录（未分组）</option>{data.folders.map(path => <option key={path} value={path}>{path}</option>)}</select>
      <button type="button" className={buttonClass} disabled={busy || !selectedIds.length} onClick={() => void act('move')}>移动已选 {selectedIds.length} 题</button>
      {message ? <p role="status" className="text-xs text-emerald-700">{message}</p> : null}
    </div>
    <nav aria-label="题目文件夹" className="min-h-0 flex-1 overflow-auto">
      <button type="button" className="p-2 text-xs text-slate-600" onClick={() => { setSelectedFolder(''); setName(''); }}>全部目录 · {items.length} 道匹配题目</button>
      {branch('')}
      {!items.length ? <p className="p-3 text-xs text-slate-500">暂无匹配题目；可调整搜索与筛选，或新建题目。</p> : null}
    </nav>
    {exploring ? <div role="dialog" aria-modal="true" aria-label="题库文件管理器" className="fixed inset-[5%] z-50 flex flex-col rounded-xl border bg-white p-4 shadow-2xl" onKeyDown={event => { if (event.key === 'Escape') setExploring(false); }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">题库文件管理器 · {selectedFolder || '根目录'}</h2>
        <button className={buttonClass} onClick={() => { setSelectedFolder(''); setName(''); }}>返回根目录</button>
        <button className={buttonClass} onClick={() => toggleAll(selectedFolder)}>全选 / 取消全选</button>
        <select aria-label="文件管理器移动目标" value={destination} onChange={event => setDestination(event.target.value)} className="max-w-48 rounded border p-1"><option value="">根目录</option>{data.folders.map(path => <option key={path}>{path}</option>)}</select>
        <button className={buttonClass} disabled={busy || !selectedIds.length} onClick={() => void act('move')}>移动已选 {selectedIds.length} 题</button>
        <button className={buttonClass} onClick={() => setExploring(false)}>关闭</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">点击选择；Ctrl / ⌘ 点击多选；从空白处拖动框选；双击目录进入。</p>
      <div ref={grid} className="relative min-h-0 flex-1 select-none overflow-auto bg-slate-50 p-3" onPointerDown={event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,[data-question]')) return;
        drag.current = { x: event.clientX, y: event.clientY, base: event.ctrlKey || event.metaKey ? selectedIds : [] };
        event.currentTarget.setPointerCapture(event.pointerId);
        onSelectIds?.(drag.current.base);
      }} onPointerMove={event => {
        if (!drag.current) return;
        const box = { x: Math.min(drag.current.x, event.clientX), y: Math.min(drag.current.y, event.clientY), right: Math.max(drag.current.x, event.clientX), bottom: Math.max(drag.current.y, event.clientY) };
        setRectangle(box);
        const ids = [...(grid.current?.querySelectorAll<HTMLElement>('[data-question]') ?? [])].filter(element => { const rect = element.getBoundingClientRect(); return rect.right >= box.x && rect.left <= box.right && rect.bottom >= box.y && rect.top <= box.bottom; }).map(element => element.dataset.question!);
        onSelectIds?.([...new Set([...drag.current.base, ...ids])]);
      }} onPointerUp={() => { drag.current = null; setRectangle(null); }} onPointerCancel={() => { drag.current = null; setRectangle(null); }}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(index.children.get(selectedFolder) ?? []).map(path => <button key={path} className="rounded border bg-amber-50 p-3 text-left" onDoubleClick={() => { setSelectedFolder(path); setName(path); }}><Folder className="h-6 w-6 text-amber-600" />{path.split('/').at(-1)}</button>)}
          {(index.questions.get(selectedFolder) ?? []).map(item => <div key={item.qualified_id} data-question={item.qualified_id} role="checkbox" aria-checked={selectedIds.includes(item.qualified_id)} tabIndex={0} title={item.content_preview || item.qualified_id}
            className={`min-h-24 cursor-pointer break-all rounded border p-3 text-xs ${selectedIds.includes(item.qualified_id) ? 'border-blue-500 bg-blue-100' : 'bg-white'}`}
            onClick={event => onSelectIds?.(event.ctrlKey || event.metaKey ? selectedIds.includes(item.qualified_id) ? selectedIds.filter(id => id !== item.qualified_id) : [...selectedIds, item.qualified_id] : [item.qualified_id])}
            onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onSelectIds?.(selectedIds.includes(item.qualified_id) ? selectedIds.filter(id => id !== item.qualified_id) : [...selectedIds, item.qualified_id]); } }}>
            <p className="mb-2 font-semibold">{item.qualified_id}</p><p className="line-clamp-4">{item.content_preview}</p>
          </div>)}
        </div>
      </div>
      {rectangle ? <div className="pointer-events-none fixed z-[51] border border-blue-500 bg-blue-200/30" style={{ left: rectangle.x, top: rectangle.y, width: rectangle.right - rectangle.x, height: rectangle.bottom - rectangle.y }} /> : null}
    </div> : null}
  </div>;
}
