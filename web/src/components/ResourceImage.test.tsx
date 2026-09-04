// @vitest-environment jsdom
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ResourceImage } from './ResourceImage';
import { ContentWithPrimeBrush } from './ContentWithPrimeBrush';
import { apiGetBlob } from '../api/client';
vi.mock('../api/client', () => ({apiGetBlob: vi.fn(), resourceApiUrl: (p: string) => `/api/resource/${p}`}));
afterEach(cleanup);
test('loads with authenticated binary helper and revokes URL on unmount', async () => {
  vi.mocked(apiGetBlob).mockResolvedValue(new Blob(['image']));
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  const view = render(<ResourceImage path="math/p.png" />);
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:test'));
  expect(apiGetBlob).toHaveBeenCalledWith('/api/resource/math/p.png');
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
});
test('embedded question image renders an image rather than raw marker', async () => {
  vi.mocked(apiGetBlob).mockResolvedValue(new Blob(['image']));
  URL.createObjectURL = vi.fn(() => 'blob:question');
  URL.revokeObjectURL = vi.fn();
  render(<ContentWithPrimeBrush text={'123\n:::EMBED_IMG:数学/默认/image/9dd960026799698df.png:::'} />);
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:question'));
  expect(screen.queryByText(/:::EMBED_IMG/)).toBeNull();
});
test('failed image download can be retried without reloading answers', async () => {
  vi.mocked(apiGetBlob).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Blob(['image']));
  URL.createObjectURL = vi.fn(() => 'blob:retry');
  render(<ResourceImage path="数学/默认/image/a.png" />);
  fireEvent.click(await screen.findByRole('button', { name: '重试图片' }));
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:retry');
});
