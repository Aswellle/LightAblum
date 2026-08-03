/**
 * @file src/components/common/ErrorBoundary.tsx
 * @description 全局错误边界
 *
 * 背景：设置→存储 曾因 Rust 返回字段名与前端契约不一致，
 * 对 undefined 调用 .toLocaleString() 抛 TypeError，React 无错误边界，
 * 整个界面白屏且无法恢复。此边界保证任何子组件渲染抛错时，
 * 只降级当前子树，而不是白屏整棵应用。
 */
import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return {
      hasError:  true,
      message:   err instanceof Error ? err.message : String(err),
    }
  }

  componentDidCatch(err: unknown) {
    console.error('[ErrorBoundary] 界面渲染出错：', err)
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position:        'fixed',
          inset:           0,
          zIndex:          'var(--la-z-toast)' as unknown as number,
          display:         'flex',
          flexDirection:   'column',
          alignItems:      'center',
          justifyContent:  'center',
          gap:             '10px',
          backgroundColor: 'var(--la-bg-app)',
          color:           'var(--la-text-secondary)',
          fontSize:        'var(--la-text-sm)',
        }}>
          <p style={{ margin: 0 }}>界面渲染出错</p>
          <p style={{ margin: 0, fontSize: 'var(--la-text-xs)', color: 'var(--la-text-tertiary)', maxWidth: 420, textAlign: 'center' }}>
            {this.state.message}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding:           '6px 16px',
              borderRadius:      'var(--la-radius-md)',
              backgroundColor:   'var(--la-accent)',
              color:             '#fff',
              border:            'none',
              cursor:            'pointer',
              fontSize:          'var(--la-text-sm)',
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
