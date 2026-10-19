import { render, screen, fireEvent, within } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { BankFolderExplorer } from './BankFolderExplorer';
import { apiPost } from '../api/client';
vi.mock('../api/client', () => ({ apiPost: vi.fn() }));

test('renders nested folders and questions, and moves the selected batch', async () => {
  vi.mocked(apiPost).mockResolvedValue({ folders: ['数学', '数学/函数'], assignments: { q1: '数学/函数' } });
  const changed = vi.fn();
  render(<BankFolderExplorer data={{ folders: ['数学', '数学/函数'], assignments: { q1: '数学/函数' } }}
    items={[{ qualified_id: 'q1' }]} selectedIds={['q1']} onChange={changed} onError={vi.fn()}
    renderItem={item => <li key={item.qualified_id}><button>{item.qualified_id}</button></li>} />);
  expect(screen.getByText('函数')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'q1' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('移动到目录'), { target: { value: '数学/函数' } });
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
  expect(screen.getByRole('dialog', { name: /^题库文件管理器/ })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '全选 / 取消全选' }));
  expect(selected).toHaveBeenLastCalledWith(['q1', 'q2']);
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
