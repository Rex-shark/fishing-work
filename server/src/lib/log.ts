// 簡單結構化 log：一行一筆 JSON（時間、事件、欄位）

export type LogFields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};
