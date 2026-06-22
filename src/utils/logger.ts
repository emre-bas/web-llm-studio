type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let devLogsEnabled = false

export function setDevLogs(enabled: boolean) {
  devLogsEnabled = enabled
}

export function isDevLogsEnabled(): boolean {
  return devLogsEnabled
}

function log(level: LogLevel, module: string, ...args: unknown[]) {
  if (!devLogsEnabled && level === 'debug') return
  const prefix = `[LLM Studio:${module}]`
  switch (level) {
    case 'debug':
      console.debug(prefix, ...args)
      break
    case 'info':
      console.info(prefix, ...args)
      break
    case 'warn':
      console.warn(prefix, ...args)
      break
    case 'error':
      console.error(prefix, ...args)
      break
  }
}

export function createLogger(module: string) {
  return {
    debug: (...args: unknown[]) => log('debug', module, ...args),
    info: (...args: unknown[]) => log('info', module, ...args),
    warn: (...args: unknown[]) => log('warn', module, ...args),
    error: (...args: unknown[]) => log('error', module, ...args),
  }
}
