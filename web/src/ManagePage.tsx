import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Form, Space, Typography, Alert, Spin, Table, Modal, Card, Popconfirm, App as AntApp } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from './api';
import type { Tag, Model, Source } from './api';
import { formatDateTime } from './utils';
import './app.css';

const { Title, Text } = Typography;

export type ManageKind = 'tags' | 'models' | 'sources';

interface Props {
  kind: ManageKind;
}

const KIND_CONFIG: Record<ManageKind, { label: string; maxLen: number; deleteHint: string; hasNote: boolean; cardView: boolean }> = {
  tags: { label: '标签', maxLen: 30, deleteHint: '将自动从所有提示词中移除该标签。', hasNote: false, cardView: true },
  models: { label: '模型', maxLen: 100, deleteHint: '将自动清除所有提示词中对该模型的引用。', hasNote: true, cardView: false },
  sources: { label: '来源', maxLen: 50, deleteHint: '将自动清除所有提示词中对来源的引用。', hasNote: true, cardView: false },
};

type Entity = Tag | Model | Source;

interface FormValues {
  name: string;
  note?: string;
}

export function ManagePage({ kind }: Props) {
  const cfg = KIND_CONFIG[kind];
  const { message, modal } = AntApp.useApp();
  const [items, setItems] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const movingRef = useRef(false);

  const list = kind === 'tags' ? api.listTags : kind === 'models' ? api.listModels : api.listSources;
  const create = kind === 'tags' ? api.createTag : kind === 'models' ? api.createModel : api.createSource;
  const update = kind === 'tags' ? api.updateTag : kind === 'models' ? api.updateModel : api.updateSource;
  const remove = kind === 'tags' ? api.removeTag : kind === 'models' ? api.removeModel : api.removeSource;
  const reorder = kind === 'tags' ? api.reorderTags : kind === 'models' ? api.reorderModels : api.reorderSources;

  const load = useCallback(async () => {
    try {
      const data = await list();
      setItems(data.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((item) => item.name.toLowerCase().includes(kw));
  }, [items, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', note: '' });
    setModalOpen(true);
  };

  const openEdit = (item: Entity) => {
    setEditing(item);
    form.setFieldsValue({ name: item.name, note: 'note' in item ? item.note ?? '' : '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const name = values.name.trim();
      const note = values.note?.trim() ?? '';
      if (editing) {
        if (cfg.hasNote) {
          await update(editing.id, name, note);
        } else {
          await update(editing.id, name);
        }
      } else {
        if (cfg.hasNote) {
          await create(name, note);
        } else {
          await create(name);
        }
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      if (e instanceof Error) {
        message.error(e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item: Entity) => {
    modal.confirm({
      title: `删除${cfg.label}`,
      content: `确定删除${cfg.label}「${item.name}」吗？${cfg.deleteHint}`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await remove(item.id);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  // ---------- 上下移动排序 ----------

  const canDrag = keyword.trim() === '';

  const handleMove = async (item: Entity, dir: 'up' | 'down') => {
    if (movingRef.current) return;
    const list = canDrag ? items : filtered;
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx === -1) return;
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    movingRef.current = true;
    const arr = [...list];
    const [moved] = arr.splice(idx, 1);
    arr.splice(targetIdx, 0, moved);
    try {
      await reorder(arr.map((i) => Number(i.id)));
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '排序失败');
      void load();
    } finally {
      movingRef.current = false;
    }
  };

  // ---------- 表格模式列定义 ----------

  const columns: ColumnsType<Entity> = [
    {
      title: '排序',
      key: 'move',
      width: 70,
      align: 'center',
      render: (_, record, idx) => {
        const list = canDrag ? items : filtered;
        const isFirst = list.findIndex((i) => i.id === record.id) === 0;
        const isLast = list.findIndex((i) => i.id === record.id) === list.length - 1;
        return (
          <Space size={2}>
            <Button
              size="small"
              type="text"
              icon={<ArrowUpOutlined />}
              disabled={!canDrag || isFirst}
              onClick={() => handleMove(record, 'up')}
            />
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              disabled={!canDrag || isLast}
              onClick={() => handleMove(record, 'down')}
            />
          </Space>
        );
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text>{text}</Text>,
    },
    ...(cfg.hasNote
      ? [
          {
            title: '备注',
            dataIndex: 'note',
            key: 'note',
            render: (text: string) => (text ? <Text>{text}</Text> : null),
          },
        ]
      : []),
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (t: string) => <Text>{formatDateTime(t)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
        </Space>
      ),
    },
  ];

  // ---------- 卡片模式渲染 ----------

  const handleCardClick = (item: Entity) => {
    openEdit(item);
  };

  const renderCardList = () => (
    <div className="manage-card-grid">
      {filtered.map((item, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === filtered.length - 1;
        return (
          <div key={item.id} className="manage-card-item">
            <Card
              size="small"
              className="manage-card"
              hoverable
              onClick={() => handleCardClick(item)}
            >
              <div className="manage-card-head">
                <span className="manage-card-name">{item.name}</span>
                <Space size={2} className="manage-card-move" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    disabled={!canDrag || isFirst}
                    onClick={() => handleMove(item, 'up')}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowRightOutlined />}
                    disabled={!canDrag || isLast}
                    onClick={() => handleMove(item, 'down')}
                  />
                </Space>
              </div>
            </Card>
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div className="manage-card-empty">
          {keyword.trim() ? `没有符合条件的${cfg.label}` : `还没有${cfg.label}`}
        </div>
      )}
    </div>
  );

  const renderTable = () => (
    <Table<Entity>
      dataSource={filtered}
      columns={columns}
      rowKey="id"
      size="middle"
      pagination={false}
      locale={{ emptyText: keyword.trim() ? `没有符合条件的${cfg.label}` : `还没有${cfg.label}` }}
    />
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-inner">
          <Space>
            <Link to="/">
              <Button type="text" icon={<ArrowLeftOutlined />} />
            </Link>
            <Title level={4} style={{ margin: 0 }}>
              {cfg.label}（共 {items.length} 条）
            </Title>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增
          </Button>
        </div>
        <div className="container">
          <div className="toolbar">
            <div className="toolbar-right">
              <Input
                style={{ width: 240 }}
                placeholder={`搜索${cfg.label}名称`}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                allowClear
              />
            </div>
          </div>
        </div>
      </header>

      <main className="container">
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        {loading ? (
          <div className="empty-center">
            <Spin />
          </div>
        ) : cfg.cardView ? (
          renderCardList()
        ) : (
          <div style={{ paddingTop: 16 }}>
            {renderTable()}
          </div>
        )}
      </main>

      <Modal
        title={editing ? `编辑${cfg.label}` : `新增${cfg.label}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        mask={false}
        destroyOnHidden
        footer={
          editing ? (
            <Space>
              <Popconfirm
                title={`删除${cfg.label}`}
                description={`确定删除「${editing.name}」吗？${cfg.deleteHint}`}
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={async () => {
                  try {
                    await remove(editing.id);
                    setModalOpen(false);
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '删除失败');
                  }
                }}
              >
                <Button danger loading={saving}>
                  删除
                </Button>
              </Popconfirm>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                确定
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>
                确定
              </Button>
            </Space>
          )
        }
      >
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: '60px' }}
          wrapperCol={{ flex: 'auto' }}
          style={{ marginTop: 16 }}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={cfg.maxLen} placeholder={`请输入${cfg.label}名称`} />
          </Form.Item>
          {cfg.hasNote && (
            <Form.Item label="备注" name="note">
              <Input.TextArea maxLength={500} placeholder="备注（可选）" autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
