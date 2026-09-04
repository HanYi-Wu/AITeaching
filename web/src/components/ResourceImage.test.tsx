// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
  render(<ContentWithPrimeBrush text={'题目\n:::EMBED_IMG:math/photo.png:::'} />);
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:question'));
  expect(screen.queryByText(/:::EMBED_IMG/)).toBeNull();
});
