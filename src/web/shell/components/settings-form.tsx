/**
 * 设置表单（详设 §7）：模型服务地址、模型凭据（只写不读回）、任务并发上限、
 * 采集后自动分析开关、日志级别；其余项只读展示。
 */

import { useEffect, useState } from 'react'

import type { ClientSettings, LogLevel, SettingsPatch } from '../api/settings'
import { LOG_LEVELS, LOG_LEVEL_LABELS, maskSecret, validateSettingsPatch } from '../api/settings'
import type { FailureLike } from '../present/error-presentation'
import { ErrorNotice } from '../present/notice'
import { TERMS } from '../terminology'

/** 设置表单入参。 */
export interface SettingsFormProps {
  settings: ClientSettings | null
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  failure: FailureLike | null
  readOnly: boolean
  onReload(): void
  onSave(patch: SettingsPatch): void
}

/** 设置表单。 */
export function SettingsForm({ settings, phase, failure, readOnly, onReload, onSave }: SettingsFormProps) {
  const [baseUrl, setBaseUrl] = useState(settings?.model.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [concurrency, setConcurrency] = useState(String(settings?.model.taskConcurrency ?? 4))
  const [problem, setProblem] = useState<string | null>(null)

  // 设置是异步读取的：送达后同步表单当前值（不覆盖使用者正在输入的内容由后到的整次覆盖保证）。
  useEffect(() => {
    if (!settings) return
    setBaseUrl(settings.model.baseUrl)
    setConcurrency(String(settings.model.taskConcurrency))
  }, [settings])

  if (phase !== 'ready' || settings === null) {
    return (
      <section className="shell-settings-form">
        {phase === 'failed' && failure ? (
          <ErrorNotice failure={failure} onAction={onReload} compact />
        ) : (
          <p className="shell-settings-form__hint">正在读取设置…</p>
        )}
      </section>
    )
  }

  const submit = () => {
    const patch: SettingsPatch = {
      model: {
        baseUrl,
        taskConcurrency: Number(concurrency),
      },
      log: { level: settings.log.level },
    }
    if (apiKey.trim().length > 0) patch.model = { ...patch.model, apiKey }
    const reason = validateSettingsPatch(patch)
    setProblem(reason)
    if (reason) return
    onSave(patch)
    setApiKey('')
  }

  return (
    <section className="shell-settings-form">
      <dl className="shell-settings-form__readonly">
        <div>
          <dt>模型凭据</dt>
          <dd>{maskSecret(settings.model.apiKeyConfigured)}</dd>
        </div>
        <div>
          <dt>采集可执行程序</dt>
          <dd>{settings.cli.executable || '自动探测'}</dd>
        </div>
        <div>
          <dt>本机服务端口</dt>
          <dd>{settings.server.port === 0 ? '自动选择空闲端口' : settings.server.port}</dd>
        </div>
        <div>
          <dt>日志保留天数</dt>
          <dd>{settings.log.retentionDays}</dd>
        </div>
      </dl>

      <label className="shell-field">
        <span>模型服务地址</span>
        <input type="text" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>

      <label className="shell-field">
        <span>模型凭据（留空表示不改动）</span>
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>

      <label className="shell-field">
        <span>模型任务并发上限（1 到 8）</span>
        <input
          type="number"
          min={1}
          max={8}
          value={concurrency}
          onChange={(event) => setConcurrency(event.target.value)}
        />
      </label>

      <label className="shell-field">
        <span>日志级别</span>
        <select
          value={settings.log.level}
          disabled={readOnly}
          onChange={(event) => onSave({ log: { level: event.target.value as LogLevel } })}
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LOG_LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </label>

      <label className="shell-check">
        <input
          type="checkbox"
          checked={settings.ingest.autoTriggerAfterIngest}
          disabled={readOnly}
          onChange={(event) => onSave({ ingest: { autoTriggerAfterIngest: event.target.checked } })}
        />
        <span>采集完成后自动分析</span>
      </label>

      {problem ? <p className="shell-settings-form__problem">{problem}</p> : null}
      {readOnly ? (
        <p className="shell-settings-form__hint">
          {TERMS.dataStatus.readOnly}：{TERMS.dataStatus.readOnlyHint}
        </p>
      ) : null}

      <div className="shell-settings-form__actions">
        <button type="button" className="shell-button shell-button--primary" disabled={readOnly} onClick={submit}>
          保存设置
        </button>
        <button type="button" className="shell-button" onClick={onReload}>
          重新读取
        </button>
      </div>
    </section>
  )
}
