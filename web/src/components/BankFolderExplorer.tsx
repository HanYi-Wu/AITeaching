import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Folder } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { apiPost } from '../api/client';
import { confirmDialog } from '../lib/confirmDialog';
import { notifyContentLibraryChanged } from '../lib/contentEvents';

import {
  type BankFolders,
  buildBankFolderIndex,
  canMoveBankFolder,
  canMoveBankQuestions,
  isDescendantOrSelfFolder,
  validateBankFolderPath,
} from '../pages/bank/bankModel';
import {
  pruneStaleSelection,
  toggleFolderOrFilteredSelection,
} from '../pages/bank/bankOperationModel';
import { BankFileGrid } from './BankFileGrid';

export type { BankFolders };
type Item = { qualified_id: string; content_preview?: string };
const buttonClass = 'rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50';

export function BankFolderExplorer<T extends Item>({ data, items, allItems, selectedIds, onChange, onError, renderItem, onSelectIds, onOpenItem, onRefresh }: {
  data: BankFolders; items: T[]; allItems?: T[]; selectedIds: string[]; onChange: (data: BankFolders) => void;
  onError: (message: string | null) => void; renderItem: (item: T) => ReactNode;
  onSelectIds?: (ids: string[]) => void;
  onOpenItem?: (id: string) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const availableItems = allItems ?? items;
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
  const fileDrag = useRef<{ x: number; y: number; ids?: string[]; folder?: string; moved: boolean } | null>(null);
  const blockClickUntil = useRef(0);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const transferType = 'application/x-eh-bank';
  async function perform(body: { action: string; path: string; target?: string; qualified_ids?: string[] }) {
    if (busy) return;
    const snapshot = {
      action: body.action,
      path: body.path,
      target: body.target,
      qualified_ids: body.qualified_ids ? [...body.qualified_ids] : undefined,
    };
    let warningMsg: string | null = null;
    if (snapshot.action === 'move_folder') {
      if (!data.folders.includes(snapshot.path)) {
        onError('源目录不存在或已失效');
        return;
      }
      if (snapshot.target && !data.folders.includes(snapshot.target)) {
        onError('目标目录不存在或已失效');
        return;
      }
      const check = canMoveBankFolder(snapshot.path, snapshot.target ?? '', data.folders);
      if (!check.ok) { onError(check.reason ?? '移动目录失败'); return; }
    } else if (snapshot.action === 'move') {
      if (snapshot.path && !data.folders.includes(snapshot.path)) {
        onError('目标目录不存在或已失效');
        return;
      }
      const currentItemIds = new Set(availableItems.map((it) => it.qualified_id));
      const { valid, stale } = pruneStaleSelection(snapshot.qualified_ids ?? [], currentItemIds);
      if (stale.length > 0) {
        onSelectIds?.(valid);
        if (valid.length === 0) {
          onError('所选题目已不存在或已失效，未执行移动');
          return;
        }
        warningMsg = `部分题目（${stale.length} 道）已不存在或已失效，仅移动尚有效的题目`;
        onError(warningMsg);
      }
      snapshot.qualified_ids = valid;
      const check = canMoveBankQuestions(snapshot.qualified_ids, snapshot.path, data.folders);
      if (!check.ok) { onError(check.reason ?? '移动题目失败'); return; }
    } else if (snapshot.action === 'create') {
      const check = validateBankFolderPath(snapshot.path);
      if (!check.ok) { onError(check.reason ?? '目录路径无效'); return; }
      if (data.folders.includes(snapshot.path)) {
        onError('目录已存在');
        return;
      }
    } else if (snapshot.action === 'rename') {
      const check = validateBankFolderPath(snapshot.target ?? '');
      if (!check.ok) { onError(check.reason ?? '目录路径无效'); return; }
      if (snapshot.target === snapshot.path) {
        setEditing(null);
        return;
      }
      if (snapshot.target && isDescendantOrSelfFolder(snapshot.target, snapshot.path)) {
        onError('不能将目录重命名为自身的子目录');
        return;
      }
      if (snapshot.target && data.folders.includes(snapshot.target)) {
        onError('目标目录已存在，不允许重命名覆盖');
        return;
      }
    } else if (snapshot.action === 'remove') {
      if (!data.folders.includes(snapshot.path)) {
        onError('所选目录不存在或已失效');
        return;
      }
    }
    setBusy(true);
    if (!warningMsg) onError(null);
    try {
      const result = await apiPost<BankFolders>('/api/bank/folders/actions', snapshot);
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
    if (busy) return;
    setClipboard(folder ? { folder } : { ids: [...selectedIds] }); setMenu(null);
  }
  function paste(target = selectedFolder) {
    if (busy || !clipboard) return;
    const snapClipboard = { ...clipboard, ids: clipboard.ids ? [...clipboard.ids] : undefined };
    const snapTarget = target;
    void perform(snapClipboard.folder ? { action: 'move_folder', path: snapClipboard.folder, target: snapTarget } : { action: 'move', path: snapTarget, qualified_ids: snapClipboard.ids });
  }
  function drop(event: React.DragEvent, target: string) {
    event.preventDefault(); event.stopPropagation();
    fileDrag.current = null; setDropHighlight(null);
    if (busy) return;
    try {
      const value = JSON.parse(event.dataTransfer.getData(transferType));
      const snapTarget = target;
      if (typeof value.folder === 'string') void perform({ action: 'move_folder', path: value.folder, target: snapTarget });
      else if (Array.isArray(value.ids)) void perform({ action: 'move', path: snapTarget, qualified_ids: [...value.ids] });
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
    if (target !== null) {
      const snapTarget = target;
      void perform(source.folder ? { action:'move_folder',path:source.folder,target:snapTarget } : { action:'move',path:snapTarget,qualified_ids:source.ids ? [...source.ids] : [] });
    }
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
    onSelectIds?.(toggleFolderOrFilteredSelection(selectedIds, ids));
  }
  const index = useMemo(() => buildBankFolderIndex(data, items), [data, items]);

  async function act(action: string) {
    if (busy) return;
    const snapName = name.trim();
    const snapDestination = destination;
    const snapSelectedFolder = selectedFolder;
    const snapSelectedIds = [...selectedIds];

    let warningMsg: string | null = null;
    let validIdsToMove = snapSelectedIds;
    if (action === 'create') {
      const check = validateBankFolderPath(snapName);
      if (!check.ok) { onError(check.reason ?? '目录路径无效'); return; }
      if (data.folders.includes(snapName)) {
        onError('目录已存在');
        return;
      }
    }
    if (action === 'rename') {
      const check = validateBankFolderPath(snapName);
      if (!check.ok) { onError(check.reason ?? '目录路径无效'); return; }
      if (snapName === snapSelectedFolder) {
        setName('');
        return;
      }
      if (isDescendantOrSelfFolder(snapName, snapSelectedFolder)) {
        onError('不能将目录重命名为自身的子目录');
        return;
      }
      if (data.folders.includes(snapName)) {
        onError('目标目录已存在，不允许重命名覆盖');
        return;
      }
    }
    if (action === 'move') {
      if (snapDestination && !data.folders.includes(snapDestination)) {
        onError('目标目录不存在或已失效');
        return;
      }
      const currentItemIds = new Set(availableItems.map((it) => it.qualified_id));
      const { valid, stale } = pruneStaleSelection(snapSelectedIds, currentItemIds);
      if (stale.length > 0) {
        onSelectIds?.(valid);
        if (valid.length === 0) {
          onError('所选题目已不存在或已失效，未执行移动');
          return;
        }
        warningMsg = `部分题目（${stale.length} 道）已不存在或已失效，仅移动尚有效的题目`;
        onError(warningMsg);
      }
      validIdsToMove = valid;
      const check = canMoveBankQuestions(validIdsToMove, snapDestination, data.folders);
      if (!check.ok) { onError(check.reason ?? '移动题目失败'); return; }
    }
    if (action === 'remove') {
      if (!snapSelectedFolder || !data.folders.includes(snapSelectedFolder)) {
        onError('所选目录不存在或已失效');
        return;
      }
      if (!(await confirmDialog('删除此目录及子目录？题目会移到父目录，不会删除题目。'))) return;
      if (busy) return;
    }
    setBusy(true);
    if (!warningMsg) onError(null);
    try {
      const body = action === 'move' ? { action, path: snapDestination, qualified_ids: validIdsToMove }
        : action === 'create' ? { action, path: snapName }
        : { action, path: snapSelectedFolder, target: snapName };
      const result = await apiPost<BankFolders>('/api/bank/folders/actions', body);
      onChange(result);
      setSelectedFolder(action === 'remove' ? '' : action === 'create' || action === 'rename' ? snapName : snapSelectedFolder);
      setName('');
      if (snapDestination && !result.folders.includes(snapDestination)) setDestination('');
      setMessage(action === 'move' ? `已移动 ${validIdsToMove.length} 道题目` : '目录已保存');
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
      <p className="truncate text-xs font-medium text-slate-700" title={selectedFolder || '根目录（未分组）'}>当前：{selectedFolder || '全部目录'}</p>
      <div className="flex flex-wrap gap-1">
        {onSelectIds ? <button type="button" className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100" onClick={() => toggleAll('')}>{items.length > 0 && items.every(item => selectedIds.includes(item.qualified_id)) ? '取消全选' : '全选当前结果'}</button> : null}
        {onSelectIds ? <button type="button" className={buttonClass} onClick={() => setExploring(true)}>文件管理器</button> : null}
      </div>
      <details className="rounded border border-slate-200 bg-slate-50 p-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">目录操作与分享</summary>
        <div className="mt-2 space-y-2">
      <label className="block text-xs">目录名称 / 子目录路径<input aria-label="目录路径" value={name} onChange={e => setName(e.target.value)} placeholder="数学/函数" className="mt-1 w-full rounded border px-2 py-1.5" /></label>
      <div className="flex flex-wrap gap-1">
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
        </div>
      </details>
      {message ? <p role="status" className="text-xs text-emerald-700">{message}</p> : null}
    </div>
    <nav data-drop-root aria-label="题目文件夹" className="min-h-0 flex-1 overflow-auto" onClick={e => { if (!(e.target as HTMLElement).closest('li,button,input,summary')) { onSelectIds?.([]); setFocusedFolder(''); } }} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, '')}>
      <button type="button" className="m-1 w-[calc(100%-0.5rem)] rounded border border-slate-200 bg-white p-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100" onDrop={e => drop(e, '')} onClick={() => { setSelectedFolder(''); setName(''); }}>全部目录 · {items.length} 道匹配题目</button>
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
      <BankFileGrid
        folders={index.children.get(selectedFolder) ?? []}
        questions={index.questions.get(selectedFolder) ?? []}
        selectedFolder={selectedFolder}
        focusedFolder={focusedFolder}
        dropHighlight={dropHighlight}
        selectedIds={selectedIds}
        busy={busy}
        clipboard={clipboard}
        onSelectIds={onSelectIds}
        onSetFocusedFolder={setFocusedFolder}
        onOpenFolder={(path) => {
          setSelectedFolder(path);
          setName(path);
          setFocusedFolder('');
        }}
        onOpenItem={(id) => {
          onOpenItem?.(id);
          setExploring(false);
        }}
        onContextMenu={(info) => setMenu(info)}
        onStartDrag={startDrag}
        onDrop={drop}
        onCut={() => cut()}
        onPaste={() => paste()}
        onToggleAll={toggleAll}
        onClearSelection={() => {
          onSelectIds?.([]);
          setFocusedFolder('');
          setMenu(null);
          setClipboard(null);
        }}
      />
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
      {menu!.folder ? <button role="menuitem" className={buttonClass} disabled={busy} onClick={async () => {
        if (busy) return;
        const path = menu!.folder!;
        setMenu(null);
        if (await confirmDialog('删除目录及子目录？题目保留并移到父目录。')) {
          if (busy) return;
          await perform({ action: 'remove', path });
        }
      }}>删除目录（保留题目）</button> : null}
      <button role="menuitem" className={buttonClass} onClick={() => { onSelectIds?.([]); setFocusedFolder(''); setMenu(null); }}>取消选择</button>
      <button role="menuitem" className={buttonClass} onClick={() => { setMenu(null); void onRefresh?.(); }}>刷新</button>
    </div>;
  }
}
