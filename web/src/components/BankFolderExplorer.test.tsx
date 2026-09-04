import { render, screen, fireEvent } from '@testing-library/react';
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
