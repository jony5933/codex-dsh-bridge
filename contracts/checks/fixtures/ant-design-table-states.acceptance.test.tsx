import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/services/ant-design-pro/api';

const reload = vi.fn();
let latestTableProps: any;

vi.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
  ProTable: (props: any) => {
    latestTableProps = props;
    if (props.actionRef) {
      props.actionRef.current = { reload, reloadAndRest: reload };
    }
    return (
      <div data-testid="pro-table">
        <div data-testid="empty-slot">{props.locale?.emptyText}</div>
        {props.toolBarRender?.()}
      </div>
    );
  },
  FooterToolbar: ({ children }: any) => <div>{children}</div>,
  ProDescriptions: ({ title }: any) => <div>{title}</div>,
}));

vi.mock('antd', () => ({
  Alert: ({ action, description, message }: any) => (
    <div role="alert">
      <span>{message}</span>
      <span>{description}</span>
      {action}
    </div>
  ),
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Drawer: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  Empty: ({ description }: any) => <div>{description ?? 'No data'}</div>,
  Input: (props: any) => <input {...props} />,
  message: {
    useMessage: () => [
      { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
      null,
    ],
  },
}));

vi.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ defaultMessage }: any) => defaultMessage }),
  FormattedMessage: ({ defaultMessage }: any) => <span>{defaultMessage}</span>,
}));

vi.mock('@/services/ant-design-pro/api', () => ({
  rule: vi.fn(),
  removeRule: vi.fn(),
  addRule: vi.fn(),
  updateRule: vi.fn(),
}));

vi.mock('./components/CreateForm', () => ({
  default: () => <div>Create</div>,
}));

vi.mock('./components/UpdateForm', () => ({
  default: () => <div>Update</div>,
}));

import TableList from './index';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TableList />
    </QueryClientProvider>,
  );
}

describe('Runner acceptance: TableList data states', () => {
  beforeEach(() => {
    latestTableProps = undefined;
    reload.mockReset();
    vi.clearAllMocks();
  });

  it('保留 request Promise 的 pending 语义并提供明确 Empty state', async () => {
    let resolveRequest: ((value: any) => void) | undefined;
    vi.mocked(api.rule).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }) as any,
    );
    renderPage();

    expect(latestTableProps).toBeTruthy();
    expect(screen.getByTestId('empty-slot').textContent?.trim()).not.toBe('');

    let settled = false;
    const request = latestTableProps
      .request({ current: 1, pageSize: 20 }, {}, {})
      .then((value: any) => {
        settled = true;
        return value;
      });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRequest?.({ data: [], total: 0, success: true });
    await expect(request).resolves.toMatchObject({ data: [], total: 0, success: true });
  });

  it('捕获加载错误、支持 Retry，并在恢复成功后清除旧错误', async () => {
    vi.mocked(api.rule).mockRejectedValueOnce(new Error('sensitive backend detail'));
    renderPage();

    await act(async () => {
      await expect(
        latestTableProps.request({ current: 1, pageSize: 20 }, {}, {}),
      ).resolves.toMatchObject({ success: false });
    });

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).not.toHaveTextContent('sensitive backend detail');
    const retry = screen.getByRole('button', { name: /retry|重试/i });
    fireEvent.click(retry);
    expect(reload).toHaveBeenCalledTimes(1);

    vi.mocked(api.rule).mockResolvedValueOnce({ data: [], total: 0, success: true });
    await act(async () => {
      await latestTableProps.request({ current: 1, pageSize: 20 }, {}, {});
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
