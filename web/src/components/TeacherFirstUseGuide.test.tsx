import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TeacherFirstUseGuide } from './TeacherFirstUseGuide';
import { apiPost } from '../api/client';
import { updateAccountCredentials, type PlatformUser } from '../platform/auth';
vi.mock('../api/client', () => ({ apiPost: vi.fn() }));
vi.mock('../platform/auth', () => ({ updateAccountCredentials: vi.fn() }));
const user: PlatformUser = { id: 't1', role: 'teacher', username: 't1', display_name: 'Teacher', status: 'active', teacher_guide_step: 0 };

test('first password is required and new credentials trigger the walkthrough', async () => {
  const updated = vi.fn();
  vi.mocked(updateAccountCredentials).mockResolvedValue({ user });
  render(<TeacherFirstUseGuide user={{ ...user, must_change_password: true }} onUpdated={updated} onNavigate={vi.fn()} onOpenAssistant={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: '首次登录：修改初始密码' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'old123' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new123' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new123' } });
  fireEvent.click(screen.getByRole('button', { name: '修改密码并进入引导' }));
  await waitFor(() => expect(updated).toHaveBeenCalledWith(user));
});

test('walkthrough requires acknowledgement, navigates and persists the next step', async () => {
  const updated = vi.fn(), navigate = vi.fn();
  vi.mocked(apiPost).mockResolvedValue({ user: { ...user, teacher_guide_step: 1 } });
  render(<TeacherFirstUseGuide user={user} onUpdated={updated} onNavigate={navigate} onOpenAssistant={vi.fn()} />);
  expect(navigate).toHaveBeenCalledWith('settings');
  expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/auth/teacher-guide', { step: 1 }));
  expect(updated).toHaveBeenCalled();
});

test('walkthrough can be postponed and reopened from settings without becoming a modal', async () => {
  vi.mocked(apiPost).mockResolvedValue({ user });
  render(<TeacherFirstUseGuide user={user} onUpdated={vi.fn()} onNavigate={vi.fn()} onOpenAssistant={vi.fn()} />);

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '稍后继续使用引导' }));
  expect(screen.queryByLabelText('教师使用引导')).not.toBeInTheDocument();

  window.dispatchEvent(new Event('eh-replay-teacher-guide'));
  expect(await screen.findByLabelText('教师使用引导')).toBeInTheDocument();
});

test('dismissing forever removes collapse toggle, uses pale-red styling, and persists step 8', async () => {
  const updated = vi.fn();
  const doneUser: PlatformUser = { ...user, teacher_guide_step: 8 };
  vi.mocked(apiPost).mockResolvedValue({ user: doneUser });
  const { rerender } = render(
    <TeacherFirstUseGuide user={user} onUpdated={updated} onNavigate={vi.fn()} onOpenAssistant={vi.fn()} />
  );

  expect(screen.queryByRole('button', { name: '收起说明' })).not.toBeInTheDocument();
  const dismissBtn = screen.getByRole('button', { name: '不再提示' });
  expect(dismissBtn.className).toContain('--or-error');

  fireEvent.click(dismissBtn);
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/auth/teacher-guide', { step: 8 }));
  expect(updated).toHaveBeenCalledWith(doneUser);
  expect(screen.queryByLabelText('教师使用引导')).not.toBeInTheDocument();

  rerender(<TeacherFirstUseGuide user={doneUser} onUpdated={updated} onNavigate={vi.fn()} onOpenAssistant={vi.fn()} />);
  expect(screen.queryByLabelText('教师使用引导')).not.toBeInTheDocument();
});
