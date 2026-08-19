import type { PromptType } from './api';

export const TYPE_LABELS: Record<PromptType, string> = {
  t2i: '文生图',
  t2v: '文生视频',
  i2v: '图生视频',
};

/** 格式化为 YYYY-MM-DD hh:mm:ss */
export function formatDateTime(sqliteText: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(sqliteText);
  if (!m) return sqliteText;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
