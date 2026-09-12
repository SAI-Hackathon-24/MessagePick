/**
 * 模块视图错误边界（`AC-040`：单个模块视图出错不影响其余）。
 *
 * 每个模块视图各自包一层；出错只替换该模块区域，顶栏、筛选条与其余模块照常可用。
 * 错误细节只进控制台，界面给中文提示 + 重试（不出现英文标识，`REQ-017`）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

/** 错误边界入参。 */
export interface ModuleErrorBoundaryProps {
  moduleName: string
  children: ReactNode
}

/** 错误边界状态。 */
export interface ModuleErrorBoundaryState {
  error: unknown
}

/** 边界降级文案（纯函数，便于断言）。 */
export function moduleFallbackText(moduleName: string): string {
  return `${moduleName}视图暂时无法显示；其余模块不受影响，可重试或先使用其他模块。`
}

/** 模块视图错误边界。 */
export class ModuleErrorBoundary extends Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  override state: ModuleErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ModuleErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    console.error('模块视图渲染失败', error)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="shell-module-error" role="alert">
          <p className="shell-module-error__text">{moduleFallbackText(this.props.moduleName)}</p>
          <button type="button" className="shell-button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </section>
      )
    }
    return this.props.children
  }
}
