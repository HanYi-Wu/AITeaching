import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { WorkspaceLoadBoundary } from './WorkspaceLoadBoundary';

test('failed workspace leaves sibling navigation visible with recovery instructions', () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never { throw new Error('chunk failed'); }
  render(<><nav>教师导航</nav><WorkspaceLoadBoundary><Broken /></WorkspaceLoadBoundary></>);
  expect(screen.getByText('教师导航')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('此工作区暂时无法加载');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible();
  output.mockRestore();
});
