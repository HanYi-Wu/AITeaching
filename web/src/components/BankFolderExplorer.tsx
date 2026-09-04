import { useMemo, useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import { apiPost } from '../api/client';
import { confirmDialog } from '../lib/confirmDialog';
import { notifyContentLibraryChanged } from '../lib/contentEvents';

export type BankFolders = { folders: string[]; assignments: Record<string, string> };
type Item = { qualified_id: string };
const buttonClass = 'rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50';

export function BankFolderExplorer<T extends Item>({ data, items, selectedIds, onChange, onError, renderItem }: {
  data: BankFolders; items: T[]; selectedIds: string[]; onChange: (data: BankFolders) => void;
  onError: (message: string | null) => void; renderItem: (item: T) => ReactNode;
}) {
  const [selectedFolder, setSelectedFolder] = useState('');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
  </div>;
}
