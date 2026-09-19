import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { apiPost } from '../api/client';
import { confirmDialog } from '../lib/confirmDialog';
import { notifyContentLibraryChanged } from '../lib/contentEvents';

export type BankFolders = { folders: string[]; assignments: Record<string, string> };
type Item = { qualified_id: string; content_preview?: string };
const buttonClass = 'rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50';

export function BankFolderExplorer<T extends Item>({ data, items, selectedIds, onChange, onError, renderItem, onSelectIds, onOpenItem, onRefresh }: {
  data: BankFolders; items: T[]; selectedIds: string[]; onChange: (data: BankFolders) => void;
  onError: (message: string | null) => void; renderItem: (item: T) => ReactNode;
  onSelectIds?: (ids: string[]) => void;
  onOpenItem?: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const [selectedFolder, setSelectedFolder] = useState('');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [exploring, setExploring] = useState(false);
  const [focusedFolder, setFocusedFolder] = useState('');
  const [clipboard, setClipboard] = useState<{ ids?: string[]; folder?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; folder: string | null; id?: string } | null>(null);
  const [invitation, setInvitation] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [editing, setEditing] = useState<{ action: 'create' | 'rename'; path: string; value: string } | null>(null);
  const [rectangle, setRectangle] = useState<{ x: number; y: number; right: number; bottom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; base: string[] } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const fileDrag = useRef<{ x: number; y: number; ids?: string[]; folder?: string; moved: boolean } | null>(null);
  const blockClickUntil = useRef(0);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const transferType = 'application/x-eh-bank';
  async function perform(body: { action: string; path: string; target?: string; qualified_ids?: string[] }) {
    setBusy(true); onError(null);
    try {
      const result = await apiPost<BankFolders>('/api/bank/folders/actions', body);
      onChange(result);
      if (selectedFolder && !result.folders.includes(selectedFolder)) setSelectedFolder('');
      setFocusedFolder(''); setClipboard(null); setMenu(null);
      setEditing(null);
      setMessage('目录及题目位置已保存');
      notifyContentLibraryChanged('question');
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function cut(folder = focusedFolder) {
    setClipboard(folder ? { folder } : { ids: [...selectedIds] }); setMenu(null);
  }
  function paste(target = selectedFolder) {
    if (!clipboard) return;
    void perform(clipboard.folder ? { action: 'move_folder', path: clipboard.folder, target } : { action: 'move', path: target, qualified_ids: clipboard.ids });
  }
  function drop(event: React.DragEvent, target: string) {
    event.preventDefault(); event.stopPropagation();
    fileDrag.current = null; setDropHighlight(null);
    if (busy) return;
    try {
      const value = JSON.parse(event.dataTransfer.getData(transferType));
      if (typeof value.folder === 'string') void perform({ action: 'move_folder', path: value.folder, target });
      else if (Array.isArray(value.ids)) void perform({ action: 'move', path: target, qualified_ids: value.ids });
    } catch { onError('无法读取拖动内容，请拖动本题库中的题目或文件夹'); }
  }
  function startDrag(event: React.DragEvent, id?: string, folder?: string) {
    setDropHighlight(null);
    const ids = id && selectedIds.includes(id) ? selectedIds : id ? [id] : [];
    fileDrag.current = { x:event.clientX,y:event.clientY,ids,folder,moved:true };
    if (id) { onSelectIds?.(ids); setFocusedFolder(''); }
    if (folder) { setFocusedFolder(folder); onSelectIds?.([]); }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(transferType, JSON.stringify(folder ? { folder } : { ids }));
  }
  function pointerDrag(event: React.PointerEvent) {
    const source = fileDrag.current;
    if (!source || Math.hypot(event.clientX-source.x,event.clientY-source.y) < 8) return;
    source.moved = true;
    const hit = document.elementFromPoint(event.clientX,event.clientY);
    const folder = hit?.closest<HTMLElement>('[data-folder]')?.dataset.folder;
    const target = folder ?? (hit?.closest('[data-file-area]') ? selectedFolder : hit?.closest('[data-drop-root]') ? '' : null);
    setDropHighlight(target);
  }
  function finishPointerDrag(event: { clientX: number; clientY: number }) {
    const source = fileDrag.current;
    fileDrag.current = null; setDropHighlight(null);
    if (!source?.moved || busy) return;
    blockClickUntil.current = performance.now() + 200;
    const hit = document.elementFromPoint(event.clientX,event.clientY);
    const folder = hit?.closest<HTMLElement>('[data-folder]')?.dataset.folder;
    const target = folder ?? (hit?.closest('[data-file-area]') ? selectedFolder : hit?.closest('[data-drop-root]') ? '' : null);
    if (target !== null) void perform(source.folder ? { action:'move_folder',path:source.folder,target } : { action:'move',path:target,qualified_ids:source.ids });
  }
  async function share(action: 'create' | 'redeem' | 'revoke', path = focusedFolder || selectedFolder) {
    setBusy(true); onError(null); setMenu(null);
    try {
      const result = await apiPost<BankFolders & { code?: string; question_count?: number; name?: string }>('/api/bank/folders/share', { action, path, code: action === 'revoke' ? shareCode : invitation.trim() });
      if (action === 'create') { setShareCode(result.code ?? ''); setMessage(`邀请有效7天，含${result.question_count}题；持码教师可以复制快照`); }
      if (action === 'revoke') { setShareCode(''); setMessage('邀请已撤销，已复制的题目不受影响'); }
      if (action === 'redeem') { onChange(result); setInvitation(''); setSelectedFolder(result.name ?? ''); setMessage(`已复制${result.question_count}题及图片`); await onRefresh?.(); notifyContentLibraryChanged('question'); }
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
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
          <summary data-folder={child} draggable onDragStart={e => startDrag(e, undefined, child)} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, child)} onContextMenu={e => { e.preventDefault(); setFocusedFolder(child); setMenu({ x: e.clientX, y: e.clientY, folder: child }); }} className={`cursor-pointer break-all rounded px-1 py-2 text-sm ${selectedFolder === child || dropHighlight === child ? 'bg-slate-200' : 'hover:bg-slate-100'}`} onClick={() => { setSelectedFolder(child); setName(child); }}>
            <Folder className="mr-1 inline h-4 w-4 text-amber-600" aria-hidden />{child.split('/').at(-1)}
            {onSelectIds ? <button type="button" className="ml-2 rounded border px-1 text-xs" onClick={event => { event.preventDefault(); event.stopPropagation(); toggleAll(child); }}>全选 / 取消</button> : null}
          </summary>
          {branch(child)}
        </details>
      </li>)}
      {(index.questions.get(path) ?? []).map(item => <div key={item.qualified_id} data-question={item.qualified_id} draggable onDragStart={e => startDrag(e, item.qualified_id)} onContextMenu={e => { e.preventDefault(); if (!selectedIds.includes(item.qualified_id)) onSelectIds?.([item.qualified_id]); setFocusedFolder(''); setMenu({ x: e.clientX, y: e.clientY, folder: null, id: item.qualified_id }); }}>{renderItem(item)}</div>)}
    </ul>;
  }

  return <div className="flex min-h-0 flex-1 flex-col" onClick={() => setMenu(null)} onClickCapture={e => { if (performance.now() < blockClickUntil.current) { e.preventDefault(); e.stopPropagation(); } }} onPointerDown={e => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input,select,textarea')) return;
    const element = (e.target as HTMLElement).closest<HTMLElement>('[data-folder],[data-question]');
    if (!element) return;
    const folder = element.dataset.folder, id = element.dataset.question;
    fileDrag.current = { x:e.clientX,y:e.clientY,folder,ids:id ? selectedIds.includes(id) ? [...selectedIds] : [id] : undefined,moved:false };
  }} onPointerMove={pointerDrag} onPointerUp={finishPointerDrag} onDragEnd={finishPointerDrag} onPointerCancel={() => { if (!fileDrag.current?.moved) fileDrag.current = null; setDropHighlight(null); }}>
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
      <button type="button" className={buttonClass} disabled={busy || !selectedFolder} onClick={() => void perform({ action: 'move_folder', path: selectedFolder, target: destination })}>移动当前目录及子目录</button>
      <div className="space-y-1 border-t pt-2"><button className={buttonClass} disabled={busy || !selectedFolder} onClick={() => void share('create', selectedFolder)}>生成文件夹邀请CDK</button>
        {shareCode ? <><input aria-label="生成的邀请码" readOnly value={shareCode} className="w-full rounded border p-1 text-xs" onFocus={e => e.target.select()} /><button className={buttonClass} disabled={busy} onClick={() => void share('revoke')}>撤销邀请</button></> : null}
        <input aria-label="输入文件夹邀请CDK" value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="输入其他教师的CDK" className="w-full rounded border p-1 text-xs" /><button className={buttonClass} disabled={busy || !invitation.trim()} onClick={() => void share('redeem')}>导入分享文件夹</button></div>
      {message ? <p role="status" className="text-xs text-emerald-700">{message}</p> : null}
    </div>
    <nav data-drop-root aria-label="题目文件夹" className="min-h-0 flex-1 overflow-auto" onClick={e => { if (!(e.target as HTMLElement).closest('li,button,input,summary')) { onSelectIds?.([]); setFocusedFolder(''); } }} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, '')}>
      <button type="button" className="p-2 text-xs text-slate-600" onDrop={e => drop(e, '')} onClick={() => { setSelectedFolder(''); setName(''); }}>全部目录 · {items.length} 道匹配题目</button>
      {branch('')}
      {!items.length ? <p className="p-3 text-xs text-slate-500">暂无匹配题目；可调整搜索与筛选，或新建题目。</p> : null}
    </nav>
    {exploring ? <Dialog.Root open={exploring} onOpenChange={setExploring}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" /><Dialog.Content aria-label="题库文件管理器" aria-describedby={undefined} className="fixed inset-[5%] z-50 flex flex-col rounded-xl border bg-white p-4 shadow-2xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Dialog.Title asChild><h2 className="mr-auto font-semibold">题库文件管理器 · {selectedFolder || '根目录'}</h2></Dialog.Title>
        <button className={buttonClass} onClick={() => { setSelectedFolder(''); setName(''); }}>返回根目录</button>
        <button className={buttonClass} disabled={!selectedFolder} onClick={() => { setSelectedFolder(selectedFolder.split('/').slice(0,-1).join('/')); setFocusedFolder(''); }}>上一级</button>
        <button className={buttonClass} onClick={() => toggleAll(selectedFolder)}>全选 / 取消全选</button>
        <select aria-label="文件管理器移动目标" value={destination} onChange={event => setDestination(event.target.value)} className="max-w-48 rounded border p-1"><option value="">根目录</option>{data.folders.map(path => <option key={path}>{path}</option>)}</select>
        <button className={buttonClass} disabled={busy || !selectedIds.length} onClick={() => void act('move')}>移动已选 {selectedIds.length} 题</button>
        <button className={buttonClass} disabled={!focusedFolder && !selectedIds.length} onClick={() => cut()}>剪切</button>
        <button className={buttonClass} disabled={busy || !clipboard} onClick={() => paste()}>粘贴到当前目录</button>
        <button className={buttonClass} onClick={() => setExploring(false)}>关闭</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">空白取消选择；Ctrl多选、Shift范围选择、空白框选；双击打开；拖到目录移动（包含子目录）；右键菜单，Ctrl+X/V剪切粘贴，Esc取消选择。</p>
      {message ? <p role="status" className="mb-2 text-xs text-emerald-700">{message}</p> : null}
      {shareCode ? <label className="mb-2 text-xs">邀请CDK（7天有效）<input readOnly value={shareCode} aria-label="文件管理器邀请码" onFocus={e => e.target.select()} className="ml-2 rounded border p-1" /></label> : null}
      {editing ? <form className="mb-3 flex flex-wrap items-center gap-2 rounded border bg-blue-50 p-2" onSubmit={e => { e.preventDefault(); void perform(editing.action === 'create' ? { action: 'create', path: editing.value.trim() } : { action: 'rename', path: editing.path, target: editing.value.trim() }); }}><label className="text-xs">{editing.action === 'create' ? '新目录路径' : '新路径'}<input autoFocus aria-label="文件管理器目录路径" value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value })} className="ml-2 rounded border p-1" /></label><button className={buttonClass} disabled={busy || !editing.value.trim()}>保存目录</button><button type="button" className={buttonClass} onClick={() => setEditing(null)}>取消</button></form> : null}
      <div ref={grid} data-file-area tabIndex={0} aria-label="题库文件区域" className="relative min-h-0 flex-1 select-none overflow-auto bg-slate-50 p-3" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, selectedFolder)} onContextMenu={e => { if (!(e.target as HTMLElement).closest('[data-question],[data-folder]')) { e.preventDefault(); setFocusedFolder(''); setMenu({ x: e.clientX, y: e.clientY, folder: null }); } }} onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); toggleAll(selectedFolder); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); cut(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
        if (e.key === 'Escape') { e.stopPropagation(); onSelectIds?.([]); setFocusedFolder(''); setMenu(null); }
      }} onPointerDown={event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,[data-question]')) return;
        drag.current = { x: event.clientX, y: event.clientY, base: event.ctrlKey || event.metaKey ? selectedIds : [] };
        event.currentTarget.setPointerCapture(event.pointerId);
        onSelectIds?.(drag.current.base);
        setFocusedFolder(''); setMenu(null);
      }} onPointerMove={event => {
        if (!drag.current) return;
        const box = { x: Math.min(drag.current.x, event.clientX), y: Math.min(drag.current.y, event.clientY), right: Math.max(drag.current.x, event.clientX), bottom: Math.max(drag.current.y, event.clientY) };
        setRectangle(box);
        const ids = [...(grid.current?.querySelectorAll<HTMLElement>('[data-question]') ?? [])].filter(element => { const rect = element.getBoundingClientRect(); return rect.right >= box.x && rect.left <= box.right && rect.bottom >= box.y && rect.top <= box.bottom; }).map(element => element.dataset.question!);
        onSelectIds?.([...new Set([...drag.current.base, ...ids])]);
      }} onPointerUp={() => { drag.current = null; setRectangle(null); }} onPointerCancel={() => { drag.current = null; setRectangle(null); }}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(index.children.get(selectedFolder) ?? []).map(path => <button key={path} data-folder={path} draggable onDragStart={e => startDrag(e, undefined, path)} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, path)} onContextMenu={e => { e.preventDefault(); setFocusedFolder(path); onSelectIds?.([]); setMenu({ x: e.clientX, y: e.clientY, folder: path }); }} className={`rounded border p-3 text-left ${focusedFolder === path || dropHighlight === path ? 'border-blue-500 bg-blue-100' : 'bg-amber-50'}`} onClick={() => { setFocusedFolder(path); onSelectIds?.([]); }} onDoubleClick={() => { setSelectedFolder(path); setName(path); setFocusedFolder(''); }}><Folder className="h-6 w-6 text-amber-600" />{path.split('/').at(-1)}</button>)}
          {(index.questions.get(selectedFolder) ?? []).map(item => <div key={item.qualified_id} data-question={item.qualified_id} draggable onDragStart={e => startDrag(e, item.qualified_id)} onContextMenu={e => { e.preventDefault(); if (!selectedIds.includes(item.qualified_id)) onSelectIds?.([item.qualified_id]); setFocusedFolder(''); setMenu({ x: e.clientX, y: e.clientY, folder: null, id: item.qualified_id }); }} onDoubleClick={() => { onOpenItem?.(item.qualified_id); setExploring(false); }} role="checkbox" aria-checked={selectedIds.includes(item.qualified_id)} tabIndex={0} title={item.content_preview || item.qualified_id}
            className={`min-h-24 cursor-pointer break-all rounded border p-3 text-xs ${selectedIds.includes(item.qualified_id) ? 'border-blue-500 bg-blue-100' : 'bg-white'}`}
            onClick={event => { setFocusedFolder(''); const visible = (index.questions.get(selectedFolder) ?? []).map(q => q.qualified_id); const from = visible.indexOf(anchor.current ?? ''), to = visible.indexOf(item.qualified_id); onSelectIds?.(event.shiftKey && from >= 0 ? [...new Set([...selectedIds, ...visible.slice(Math.min(from,to),Math.max(from,to)+1)])] : event.ctrlKey || event.metaKey ? selectedIds.includes(item.qualified_id) ? selectedIds.filter(id => id !== item.qualified_id) : [...selectedIds, item.qualified_id] : [item.qualified_id]); anchor.current = item.qualified_id; }}
            onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onSelectIds?.(selectedIds.includes(item.qualified_id) ? selectedIds.filter(id => id !== item.qualified_id) : [...selectedIds, item.qualified_id]); } }}>
            <p className="mb-2 font-semibold">{item.qualified_id}</p><p className="line-clamp-4">{item.content_preview}</p>
          </div>)}
        </div>
      </div>
      {rectangle ? <div className="pointer-events-none fixed z-[51] border border-blue-500 bg-blue-200/30" style={{ left: rectangle.x, top: rectangle.y, width: rectangle.right - rectangle.x, height: rectangle.bottom - rectangle.y }} /> : null}
      {menu ? contextMenu() : null}
    </Dialog.Content></Dialog.Portal></Dialog.Root> : null}
    {!exploring && menu ? contextMenu() : null}
  </div>;

  function contextMenu() {
    return <div role="menu" aria-label="题库文件操作" className="fixed z-[60] grid min-w-44 gap-1 rounded border bg-white p-2 shadow-xl" style={{ left: Math.min(menu!.x, window.innerWidth - 210), top: Math.min(menu!.y, window.innerHeight - 310) }} onClick={e => e.stopPropagation()}>
      {menu!.folder ? <><button role="menuitem" className={buttonClass} onClick={() => { setSelectedFolder(menu!.folder!); setName(menu!.folder!); setMenu(null); }}>打开目录</button><button role="menuitem" className={buttonClass} onClick={() => { setEditing({ action: 'rename', path: menu!.folder!, value: menu!.folder! }); setExploring(true); setMenu(null); }}>重命名目录</button><button role="menuitem" className={buttonClass} disabled={busy} onClick={() => void share('create', menu!.folder!)}>生成邀请CDK</button></> : null}
      {menu!.id ? <button role="menuitem" className={buttonClass} onClick={() => { onOpenItem?.(menu!.id!); setExploring(false); setMenu(null); }}>编辑题目</button> : null}
      <button role="menuitem" className={buttonClass} disabled={!menu!.folder && !selectedIds.length} onClick={() => cut(menu!.folder ?? '')}>剪切</button>
      <button role="menuitem" className={buttonClass} disabled={busy || !clipboard} onClick={() => paste(menu!.folder ?? selectedFolder)}>粘贴到此目录</button>
      <button role="menuitem" className={buttonClass} onClick={() => { const parent = menu!.folder ?? selectedFolder; setEditing({ action: 'create', path: parent, value: parent ? parent + '/新目录' : '新目录' }); setExploring(true); setMenu(null); }}>新建子目录</button>
      {menu!.folder ? <button role="menuitem" className={buttonClass} disabled={busy} onClick={async () => { const path = menu!.folder!; setMenu(null); if (await confirmDialog('删除目录及子目录？题目保留并移到父目录。')) await perform({ action: 'remove', path }); }}>删除目录（保留题目）</button> : null}
      <button role="menuitem" className={buttonClass} onClick={() => { onSelectIds?.([]); setFocusedFolder(''); setMenu(null); }}>取消选择</button>
      <button role="menuitem" className={buttonClass} onClick={() => { setMenu(null); void onRefresh?.(); }}>刷新</button>
    </div>;
  }
}
