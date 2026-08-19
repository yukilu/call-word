import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { Button, Input, Select, Empty, Spin, Alert, Space, Typography, App as AntApp } from 'antd';
import { PlusOutlined, TagsOutlined, ExperimentOutlined, ClusterOutlined, StarFilled, LogoutOutlined, ShareAltOutlined } from '@ant-design/icons';
import { api, tokenStore } from './api';
import type { Model, ModelRef, Prompt, PromptInput, PromptType, Source, Tag } from './api';
import { PromptCard } from './PromptCard';
import { PromptModal } from './PromptModal';
import { ManagePage } from './ManagePage';
import { ModelRefPage } from './ModelRefPage';
import { LoginPage } from './LoginPage';
import './app.css';

const { Title, Text } = Typography;

type TypeFilter = PromptType | '';

const TYPE_OPTIONS: { label: string; value: PromptType }[] = [
  { label: '文生图', value: 't2i' },
  { label: '文生视频', value: 't2v' },
  { label: '图生视频', value: 'i2v' },
];

// 首页卡片分页：每次加载页大小，滚动到底部自动加载下一页
const PAGE_SIZE = 20;
// 触发加载下一页的距离阈值（距底部多少 px）
const LOAD_MORE_THRESHOLD = 240;

function HomePage({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [items, setItems] = useState<Prompt[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [modelRefs, setModelRefs] = useState<ModelRef[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [tagFilter, setTagFilter] = useState<number | ''>('');
  const [modelFilter, setModelFilter] = useState<number | ''>('');
  const [favOnly, setFavOnly] = useState(false);
  const [promptModal, setPromptModal] = useState<{ editing: Prompt | null } | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const { message } = AntApp.useApp();

  const tagMap = useMemo(() => {
    const m: Record<number, Tag> = {};
    for (const t of tags) m[t.id] = t;
    return m;
  }, [tags]);

  const modelMap = useMemo(() => {
    const m: Record<number, Model> = {};
    for (const m_ of models) m[m_.id] = m_;
    return m;
  }, [models]);

  const modelRefMap = useMemo(() => {
    const m: Record<number, ModelRef> = {};
    for (const r of modelRefs) m[r.id] = r;
    return m;
  }, [modelRefs]);

  const sourceMap = useMemo(() => {
    const m: Record<number, Source> = {};
    for (const s of sources) m[s.id] = s;
    return m;
  }, [sources]);

  const loadPrompts = useCallback(async () => {
    try {
      const data = await api.list();
      setItems(data.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const data = await api.listTags();
      setTags(data.items);
    } catch {
      /* 标签加载失败不阻塞 */
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const data = await api.listModels();
      setModels(data.items);
    } catch {
      /* 模型加载失败不阻塞 */
    }
  }, []);

  const loadModelRefs = useCallback(async () => {
    try {
      const data = await api.listModelRefs();
      setModelRefs(data.items);
    } catch {
      /* 模型资源加载失败不阻塞 */
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const data = await api.listSources();
      setSources(data.items);
    } catch {
      /* 来源加载失败不阻塞 */
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadPrompts(), loadTags(), loadModels(), loadModelRefs(), loadSources()]);
  }, [loadPrompts, loadTags, loadModels, loadModelRefs, loadSources]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter(
      (p) =>
        (typeFilter === '' || p.type === typeFilter) &&
        (!favOnly || p.favorite) &&
        (tagFilter === '' || p.tags.includes(tagFilter)) &&
        (modelFilter === '' || p.model_id === modelFilter) &&
        (!kw ||
          p.title.toLowerCase().includes(kw) ||
          p.content.toLowerCase().includes(kw) ||
          p.note.toLowerCase().includes(kw) ||
          p.url.toLowerCase().includes(kw) ||
          p.tags.some((id) => tagMap[id]?.name.toLowerCase().includes(kw)) ||
          (p.model_id != null && modelMap[p.model_id]?.name.toLowerCase().includes(kw))),
    );
  }, [items, keyword, typeFilter, tagFilter, modelFilter, favOnly, tagMap, modelMap]);

  const displayed = useMemo(() => filtered.slice(0, displayCount), [filtered, displayCount]);
  const hasMore = displayed.length < filtered.length;

  // 筛选条件变化时重置分页（回到第一页）
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [keyword, typeFilter, tagFilter, modelFilter, favOnly]);

  // 滚动到底部自动加载下一页；用 ref 拿最新值，监听器只绑定一次
  const pagingRef = useRef({ hasMore: false, loading: false });
  useEffect(() => {
    pagingRef.current = { hasMore, loading };
  });
  useEffect(() => {
    const onScroll = () => {
      const { hasMore: more, loading } = pagingRef.current;
      if (!more || loading) return;
      const { scrollHeight, scrollTop, clientHeight } = document.documentElement;
      if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD) {
        setDisplayCount((c) => c + PAGE_SIZE);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSave = async (data: PromptInput) => {
    if (promptModal?.editing) await api.update(promptModal.editing.id, data);
    else await api.create(data);
    setPromptModal(null);
    await loadPrompts();
  };

  const handleDelete = async (prompt: Prompt) => {
    try {
      await api.remove(prompt.id);
      await loadPrompts();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleToggleFavorite = async (prompt: Prompt) => {
    try {
      const updated = await api.toggleFavorite(prompt.id);
      setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* 忽略 */
    }
    onLogout();
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-inner">
          <div>
            <Title level={4} style={{ margin: 0 }}>
              提示词收藏
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              文生图 · 文生视频 · 图生视频
            </Text>
          </div>
          <Space>
            <Text type="secondary" style={{ fontSize: 13 }}>{username}</Text>
            <Link to="/tags">
              <Button icon={<TagsOutlined />}>标签</Button>
            </Link>
            <Link to="/models">
              <Button icon={<ExperimentOutlined />}>模型</Button>
            </Link>
            <Link to="/sources">
              <Button icon={<ShareAltOutlined />}>来源</Button>
            </Link>
            <Link to="/model-refs">
              <Button icon={<ClusterOutlined />}>model</Button>
            </Link>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setPromptModal({ editing: null })}>
              新增
            </Button>
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出</Button>
          </Space>
        </div>
        <div className="container">
          <div className="toolbar">
            <div className="toolbar-right">
              <Select
                style={{ width: 140 }}
                value={typeFilter || undefined}
                onChange={(v) => setTypeFilter(v ?? '')}
                placeholder="全部类型"
                allowClear
                options={TYPE_OPTIONS}
              />
              <Select
                style={{ width: 140 }}
                value={tagFilter || undefined}
                onChange={(v) => setTagFilter(v ?? '')}
                placeholder="全部标签"
                allowClear
                options={tags.map((t) => ({ label: t.name, value: t.id }))}
              />
              <Select
                style={{ width: 160 }}
                value={modelFilter || undefined}
                onChange={(v) => setModelFilter(v ?? '')}
                placeholder="全部模型"
                allowClear
                options={models.map((m) => ({ label: m.name, value: m.id }))}
              />
              <Button
                type={favOnly ? 'primary' : 'default'}
                icon={<StarFilled style={{ color: favOnly ? '#fff' : '#f5a623' }} />}
                onClick={() => setFavOnly((v) => !v)}
              >
                仅收藏
              </Button>
              <Input
                style={{ width: 280 }}
                placeholder="搜索标题、提示词、备注、标签、模型…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                allowClear
              />
            </div>
          </div>
        </div>
      </header>

      <main className="container">
        {error && (
          <Alert
            type="error"
            message={error}
            action={<Button size="small" onClick={() => void loadPrompts()}>重试</Button>}
            style={{ marginBottom: 16 }}
          />
        )}

        {loading ? (
          <div className="empty-center">
            <Spin size="large" />
          </div>
        ) : items.length === 0 ? (
          <Empty description="还没有收藏任何提示词" style={{ paddingTop: 80 }}>
            <Text type="secondary">点击右上角「新增」开始收藏吧</Text>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty description="没有符合条件的提示词" style={{ paddingTop: 80 }}>
            <Text type="secondary">换个关键词或筛选条件试试</Text>
          </Empty>
        ) : (
          <>
            <div className="grid">
              {displayed.map((p) => (
                <PromptCard
                  key={p.id}
                  prompt={p}
                  tagMap={tagMap}
                  modelMap={modelMap}
                  modelRefMap={modelRefMap}
                  sourceMap={sourceMap}
                  onEdit={(pp) => setPromptModal({ editing: pp })}
                  onDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
            {hasMore ? (
              <div className="load-more" onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}>
                <Spin />
                <Text type="secondary" style={{ marginLeft: 8 }}>向下滚动或点击加载更多</Text>
              </div>
            ) : (
              <div className="load-more-end">
                <Text type="secondary">没有更多了（共 {filtered.length} 条）</Text>
              </div>
            )}
          </>
        )}
      </main>

      {promptModal && (
        <PromptModal
          editing={promptModal.editing}
          tags={tags}
          models={models}
          modelRefs={modelRefs}
          sources={sources}
          onClose={() => setPromptModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  // 启动时检查登录状态
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then(({ user }) => setUser(user.username))
      .catch(() => tokenStore.clear())
      .finally(() => setChecking(false));

    // 监听 401 事件
    const handler = () => {
      setUser(null);
      tokenStore.clear();
      navigate('/');
    };
    window.addEventListener('auth-expired', handler);
    return () => window.removeEventListener('auth-expired', handler);
  }, [navigate]);

  if (checking) {
    return (
      <div className="login-page">
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onSuccess={setUser} />;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage username={user} onLogout={() => { setUser(null); tokenStore.clear(); navigate('/'); }} />} />
      <Route path="/tags" element={<ManagePage kind="tags" />} />
      <Route path="/models" element={<ManagePage kind="models" />} />
      <Route path="/sources" element={<ManagePage kind="sources" />} />
      <Route path="/model-refs" element={<ModelRefPage />} />
    </Routes>
  );
}
