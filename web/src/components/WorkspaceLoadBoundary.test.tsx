import { render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { expect, test, vi } from 'vitest';
import { WorkspaceLoadBoundary } from './WorkspaceLoadBoundary';

test('failed lazy chunk leaves sibling navigation visible with recovery instructions', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const BrokenChunk = lazy(() => Promise.reject(new Error('chunk failed')));
  render(
    <>
      <nav>教师导航</nav>
      <Suspense fallback={<p>工作区加载中</p>}>
        <WorkspaceLoadBoundary><BrokenChunk /></WorkspaceLoadBoundary>
      </Suspense>
    </>,
  );
  expect(screen.getByText('教师导航')).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent('此工作区暂时无法加载');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible();
  output.mockRestore();
});
