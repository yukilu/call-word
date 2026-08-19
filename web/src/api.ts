export type PromptType = 't2i' | 't2v' | 'i2v';

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Model {
  id: number;
  name: string;
  note: string;
  sort_order: number;
  created_at: string;
}

export interface Source {
  id: number;
  name: string;
  note: string;
  sort_order: number;
  created_at: string;
}

export interface ModelRef {
  id: number;
  name: string;
  ref_type: 'lora' | 'checkpoint';
  model_ids: number[];
  url: string;
  size: string;
  download_name: string;
  note: string;
  sort_order: number;
  created_at: string;
}

export interface Prompt {
  id: number;
  title: string;
  content: string;
  type: PromptType;
  tags: number[]; // 标签 id 数组
  model_id: number | null;
  model_refs: number[]; // 模型资源 id 数组
  source_id: number | null; // 来源 id
  url: string;
  note: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromptInput {
  title: string;
  content: string;
  type: PromptType;
  tags: number[];
  model_id: number | null;
  model_refs: number[];
  source_id: number | null;
  url: string;
  note: string;
  favorite: boolean;
}

const TOKEN_KEY = 'call-word-token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    tokenStore.clear();
    window.dispatchEvent(new Event('auth-expired'));
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // 认证
  register: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/api/auth/me'),

  // 提示词
  list: () => request<{ items: Prompt[] }>('/api/prompts'),
  create: (data: PromptInput) =>
    request<Prompt>('/api/prompts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: PromptInput) =>
    request<Prompt>(`/api/prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<{ ok: true }>(`/api/prompts/${id}`, { method: 'DELETE' }),
  toggleFavorite: (id: number) =>
    request<Prompt>(`/api/prompts/${id}/favorite`, { method: 'PATCH' }),

  // 标签
  listTags: () => request<{ items: Tag[] }>('/api/tags'),
  createTag: (name: string) =>
    request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name }) }),
  updateTag: (id: number, name: string) =>
    request<Tag>(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  removeTag: (id: number) => request<{ ok: true }>(`/api/tags/${id}`, { method: 'DELETE' }),
  reorderTags: (ids: number[]) =>
    request<{ ok: true }>('/api/tags/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),

  // 模型
  listModels: () => request<{ items: Model[] }>('/api/models'),
  createModel: (name: string, note?: string) =>
    request<Model>('/api/models', { method: 'POST', body: JSON.stringify({ name, note: note ?? '' }) }),
  updateModel: (id: number, name: string, note?: string) =>
    request<Model>(`/api/models/${id}`, { method: 'PUT', body: JSON.stringify({ name, note: note ?? '' }) }),
  removeModel: (id: number) => request<{ ok: true }>(`/api/models/${id}`, { method: 'DELETE' }),
  reorderModels: (ids: number[]) =>
    request<{ ok: true }>('/api/models/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),

  // 来源（维护用，编辑不改 id）
  listSources: () => request<{ items: Source[] }>('/api/sources'),
  createSource: (name: string, note?: string) =>
    request<Source>('/api/sources', { method: 'POST', body: JSON.stringify({ name, note: note ?? '' }) }),
  updateSource: (id: number, name: string, note?: string) =>
    request<Source>(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify({ name, note: note ?? '' }) }),
  removeSource: (id: number) => request<{ ok: true }>(`/api/sources/${id}`, { method: 'DELETE' }),
  reorderSources: (ids: number[]) =>
    request<{ ok: true }>('/api/sources/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),

  // 模型资源
  listModelRefs: () => request<{ items: ModelRef[] }>('/api/model-refs'),
  createModelRef: (data: { name: string; ref_type: 'lora' | 'checkpoint'; model_ids: number[]; url: string; size: string; download_name: string; note?: string }) =>
    request<ModelRef>('/api/model-refs', { method: 'POST', body: JSON.stringify(data) }),
  updateModelRef: (id: number, data: { name: string; ref_type: 'lora' | 'checkpoint'; model_ids: number[]; url: string; size: string; download_name: string; note?: string }) =>
    request<ModelRef>(`/api/model-refs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  removeModelRef: (id: number) => request<{ ok: true }>(`/api/model-refs/${id}`, { method: 'DELETE' }),
  reorderModelRefs: (ids: number[]) =>
    request<{ ok: true }>('/api/model-refs/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
};
