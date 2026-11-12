import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { BankFolderExplorer } from './BankFolderExplorer';
import { apiPost } from '../api/client';
import { selectOption } from '../test/selectOption';
vi.mock('../api/client', () => ({ apiPost: vi.fn() }));

test('renders nested folders and questions, and moves the selected batch', async () => {
  vi.mocked(apiPost).mockResolvedValue({ folders: ['数学', '数学/函数'], assignments: { q1: '数学/函数' } });
  const changed = vi.fn();
  render(<BankFolderExplorer data={{ folders: ['数学', '数学/函数'], assignments: { q1: '数学/函数' } }}
    items={[{ qualified_id: 'q1' }]} selectedIds={['q1']} onChange={changed} onError={vi.fn()}
    renderItem={item => <li key={item.qualified_id}><button>{item.qualified_id}</button></li>} />);
  expect(screen.getByText('函数')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'q1' })).toBeInTheDocument();
  await selectOption(screen.getByRole('combobox', { name: '移动到目录' }), '数学/函数');
  fireEvent.click(screen.getByRole('button', { name: '移动已选 1 题' }));
  expect(apiPost).toHaveBeenCalledWith('/api/bank/folders/actions', { action: 'move', path: '数学/函数', qualified_ids: ['q1'] });
});

test('selects all from partial selection, toggles off and opens file manager', () => {
  const selected = vi.fn();
  const props = { data: { folders: ['数学'], assignments: { q1: '数学', q2: '数学' } }, items: [{ qualified_id: 'q1' }, { qualified_id: 'q2' }], onChange: vi.fn(), onError: vi.fn(), onSelectIds: selected, renderItem: (item: {qualified_id: string}) => <li key={item.qualified_id}>{item.qualified_id}</li> };
  const view = render(<BankFolderExplorer {...props} selectedIds={['q1']} />);
  fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
  expect(selected).toHaveBeenLastCalledWith(['q1', 'q2']);
  view.rerender(<BankFolderExplorer {...props} selectedIds={['q1', 'q2']} />);
  fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
  expect(selected).toHaveBeenLastCalledWith([]);
  view.rerender(<BankFolderExplorer {...props} selectedIds={[]} />);
  fireEvent.click(screen.getByRole('button', { name: '文件管理器' }));
  const dialog = screen.getByRole('dialog', { name: /^题库文件管理器/ });
  expect(dialog).toBeInTheDocument();
  expect(dialog).not.toHaveClass('or-dialog', 'or-g48-dialog');
  const surface = dialog.querySelector('.or-g48-dialog');
  expect(surface).not.toBeNull();
  expect(surface).toHaveClass('h-full', 'max-h-full', 'min-h-0');
  expect(dialog).not.toHaveClass('or-dialog');
  expect(dialog.parentElement).toHaveClass('fixed', 'inset-0', 'flex', 'items-center', 'justify-center', 'overflow-y-auto');
  fireEvent.click(within(dialog).getByRole('button', { name: '全选 / 取消全选' }));
  expect(selected).toHaveBeenLastCalledWith(['q1', 'q2']);
});

test('keeps the file manager select popup in the dialog focus scope and supports mouse and keyboard selection', async () => {
  const user = userEvent.setup();
  render(
    <BankFolderExplorer
      data={{ folders: ['数学', '物理'], assignments: {} }}
      items={[]}
      selectedIds={[]}
      onChange={vi.fn()}
      onError={vi.fn()}
      onSelectIds={vi.fn()}
      renderItem={() => null}
    />
  );
  await user.click(screen.getByRole('button', { name: '文件管理器' }));
  const dialog = screen.getByRole('dialog', { name: /^题库文件管理器/ });
  const select = within(dialog).getByRole('combobox', { name: '文件管理器移动目标' });

  select.focus();
  await user.keyboard('{ArrowDown}');
  const keyboardList = await screen.findByRole('listbox');
  const keyboardPopup = keyboardList.closest<HTMLElement>('[data-or-select-content]');
  const surface = dialog.querySelector<HTMLElement>('.or-g48-dialog');
  expect(surface).not.toBeNull();
  expect(dialog).toContainElement(keyboardPopup);
  expect(surface).not.toContainElement(keyboardPopup);
  expect(['top', 'bottom']).toContain(keyboardPopup?.getAttribute('data-side'));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(select).toHaveTextContent('数学');

  await user.click(select);
  const mouseList = await screen.findByRole('listbox');
  await user.click(within(mouseList).getByRole('option', { name: '物理' }));
  expect(select).toHaveTextContent('物理');
  expect(dialog).toBeInTheDocument();
});

test('blank cancels selection, right click cuts and drag moves into a folder', () => {
  const selected = vi.fn();
  render(<BankFolderExplorer data={{ folders: ['folder'], assignments: {} }} items={[{qualified_id: 'q1'}]} selectedIds={['q1']}
    onChange={vi.fn()} onError={vi.fn()} onSelectIds={selected} renderItem={item => <li key={item.qualified_id}>{item.qualified_id}</li>} />);
  fireEvent.click(screen.getByRole('navigation', { name: '题目文件夹' }));
  expect(selected).toHaveBeenLastCalledWith([]);
  fireEvent.click(screen.getByRole('button', { name: '文件管理器' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.contextMenu(within(dialog).getByRole('checkbox'), { clientX: 100, clientY: 100 });
  fireEvent.click(screen.getByRole('menuitem', { name: '剪切' }));
  expect(within(dialog).getByRole('button', { name: '粘贴到当前目录' })).not.toBeDisabled();
  const folder = within(dialog).getByRole('button', { name: 'folder' });
  fireEvent.drop(folder, { dataTransfer: { getData: () => JSON.stringify({ ids: ['q1'] }) } });
  expect(apiPost).toHaveBeenLastCalledWith('/api/bank/folders/actions', { action: 'move', path: 'folder', qualified_ids: ['q1'] });
});

test('prevents moving folder into itself or its descendant on drop', () => {
  const onError = vi.fn();
  vi.mocked(apiPost).mockClear();
  render(
    <BankFolderExplorer
      data={{ folders: ['数学', '数学/代数'], assignments: {} }}
      items={[]}
      selectedIds={[]}
      onChange={vi.fn()}
      onError={onError}
      onSelectIds={vi.fn()}
      renderItem={() => null}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '文件管理器' }));
  const dialog = screen.getByRole('dialog');
  const algebraFolder = within(dialog).getByRole('button', { name: '数学' });
  // Try dropping '数学' into itself
  fireEvent.drop(algebraFolder, {
    dataTransfer: { getData: () => JSON.stringify({ folder: '数学' }) },
  });
  expect(onError).toHaveBeenCalledWith('不能将目录移到自身或子目录中');
  expect(apiPost).not.toHaveBeenCalled();
});

test('retains clipboard and selection when move action fails', async () => {
  const onError = vi.fn();
  vi.mocked(apiPost).mockRejectedValueOnce(new Error('后端网络错误'));
  render(
    <BankFolderExplorer
      data={{ folders: ['folder'], assignments: {} }}
      items={[{ qualified_id: 'q1' }]}
      selectedIds={['q1']}
      onChange={vi.fn()}
      onError={onError}
      onSelectIds={vi.fn()}
      renderItem={(item) => <div>{item.qualified_id}</div>}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '文件管理器' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.contextMenu(within(dialog).getByRole('checkbox'), { clientX: 100, clientY: 100 });
  fireEvent.click(screen.getByRole('menuitem', { name: '剪切' }));

  const pasteBtn = within(dialog).getByRole('button', { name: '粘贴到当前目录' });
  expect(pasteBtn).not.toBeDisabled();
  fireEvent.click(pasteBtn);

  // Wait for failure
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('后端网络错误'));
  // Clipboard should NOT be lost on failure
  expect(pasteBtn).not.toBeDisabled();
});

test('prunes stale questions and warns user before moving', async () => {
  const onError = vi.fn();
  const onSelect = vi.fn();
  vi.mocked(apiPost).mockResolvedValueOnce({ folders: ['数学'], assignments: { q1: '数学' } });
  render(
    <BankFolderExplorer
      data={{ folders: ['数学'], assignments: {} }}
      items={[{ qualified_id: 'q1' }]} // q2 is missing / stale
      selectedIds={['q1', 'stale_q2']}
      onChange={vi.fn()}
      onError={onError}
      onSelectIds={onSelect}
      renderItem={(item) => <div>{item.qualified_id}</div>}
    />
  );
  await selectOption(screen.getByRole('combobox', { name: '移动到目录' }), '数学');
  fireEvent.click(screen.getByRole('button', { name: '移动已选 2 题' }));

  expect(onError).toHaveBeenCalledWith(expect.stringContaining('仅移动尚有效的题目'));
  expect(onSelect).toHaveBeenCalledWith(['q1']);
  expect(apiPost).toHaveBeenCalledWith('/api/bank/folders/actions', {
    action: 'move',
    path: '数学',
    qualified_ids: ['q1'],
  });
});

test('supports moving questions that were selected before search filter using allItems', async () => {
  const onError = vi.fn();
  vi.mocked(apiPost).mockResolvedValueOnce({ folders: ['数学'], assignments: { q1: '数学' } });
  render(
    <BankFolderExplorer
      data={{ folders: ['数学'], assignments: {} }}
      items={[{ qualified_id: 'q2' }]} // current filtered search view
      allItems={[{ qualified_id: 'q1' }, { qualified_id: 'q2' }]} // complete library
      selectedIds={['q1']} // selected earlier before searching
      onChange={vi.fn()}
      onError={onError}
      onSelectIds={vi.fn()}
      renderItem={(item) => <div>{item.qualified_id}</div>}
    />
  );
  await selectOption(screen.getByRole('combobox', { name: '移动到目录' }), '数学');
  fireEvent.click(screen.getByRole('button', { name: '移动已选 1 题' }));

  expect(onError).toHaveBeenCalledWith(null);
  expect(apiPost).toHaveBeenCalledWith('/api/bank/folders/actions', {
    action: 'move',
    path: '数学',
    qualified_ids: ['q1'],
  });
});

test('prevents renaming folder to child of itself or existing folder without calling api', async () => {
  vi.mocked(apiPost).mockClear();
  const onError = vi.fn();
  const { container } = render(
    <BankFolderExplorer
      data={{ folders: ['数学', '物理'], assignments: {} }}
      items={[] as { qualified_id: string }[]}
      selectedIds={[]}
      onChange={vi.fn()}
      onError={onError}
      renderItem={(item) => <div>{item.qualified_id}</div>}
    />
  );
  fireEvent.click(container.querySelector('[data-folder="数学"]')!);
  fireEvent.change(screen.getByLabelText('目录名称 / 子目录路径'), { target: { value: '物理' } });
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  expect(onError).toHaveBeenCalledWith('目标目录已存在，不允许重命名覆盖');
  expect(apiPost).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('目录名称 / 子目录路径'), { target: { value: '数学/代数' } });
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  expect(onError).toHaveBeenCalledWith('不能将目录重命名为自身的子目录');
  expect(apiPost).not.toHaveBeenCalled();
});

test('typing inside text input does not trigger explorer keyboard shortcuts', () => {
  const onSelectIds = vi.fn();
  render(
    <BankFolderExplorer
      data={{ folders: ['数学'], assignments: { q1: '数学' } }}
      items={[{ qualified_id: 'q1' }]}
      selectedIds={[]}
      onChange={vi.fn()}
      onError={vi.fn()}
      onSelectIds={onSelectIds}
      renderItem={(item) => <div>{item.qualified_id}</div>}
    />
  );
  const input = screen.getByLabelText('目录名称 / 子目录路径');
  fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
  expect(onSelectIds).not.toHaveBeenCalled();
});




