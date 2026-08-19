import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Input,
  Radio,
  Select,
  Space,
  Typography,
  Alert,
  Spin,
  Modal,
  Form,
  Table,
  Tag,
  App as AntApp,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { api } from './api';
import type { ModelRef, Model } from './api';
import { formatDateTime } from './utils';
import './app.css';

const { Title, Text } = Typography;

type TypeFilter = 'lora' | 'checkpoint' | '';
type SortField = 'created_at' | 'download_name' | 'name' | 'size';

const TYPE_OPTIONS: { label: string; value: 'lora' | 'checkpoint' }[] = [
  { label: 'LoRA', value: 'lora' },
  { label: 'Checkpoint', value: 'checkpoint' },
];

export function ModelRefPage() {
  const { message, modal } = AntApp.useApp();
  const [items, setItems] = useState<ModelRef[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ModelRef | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [modelFilter, setModelFilter] = useState<number | ''>('');

  // 列排序（默认按创建时间降序，最新在前）
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const load = useCallback(async () => {
    try {
      const [refData, modelData] = await Promise.all([api.listModelRefs(), api.listModels()]);
      setItems(refData.items);
      setModels(modelData.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modelMap = useMemo(() => new Map(models.map((m) => [m.id, m.name])), [models]);

  const isFiltered = keyword.trim() !== '' || typeFilter !== '' || modelFilter !== '';

  // 大小数值解析（用于排序）
  const sizeValue = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter(
      (item) =>
        (typeFilter === '' || item.ref_type === typeFilter) &&
        (modelFilter === '' || item.model_ids.includes(modelFilter)) &&
        (!kw || item.name.toLowerCase().includes(kw) || item.download_name.toLowerCase().includes(kw)),
    );
  }, [items, keyword, typeFilter, modelFilter]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ ref_type: 'lora', model_ids: [], url: '', size: '', download_name: '', note: '' });
    setModalOpen(true);
  };

  const openEdit = (item: ModelRef) => {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      ref_type: item.ref_type,
      model_ids: item.model_ids,
      url: item.url,
      size: item.size,
      download_name: item.download_name,
      note: item.note ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await api.updateModelRef(editing.id, values);
      } else {
        await api.createModelRef(values);
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

  const handleDelete = (item: ModelRef) => {
    modal.confirm({
      title: '删除 model',
      content: `确定删除「${item.name}」吗？将从所有提示词中移除该引用。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.removeModelRef(item.id);
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const columns: ColumnsType<ModelRef> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      sortOrder: sortField === 'name' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      sorter: (a, b) => (a.name || '').localeCompare(b.name || '', 'zh'),
      render: (text: string) => <Text>{text}</Text>,
    },
    {
      title: '下载名称',
      dataIndex: 'download_name',
      key: 'download_name',
      ellipsis: true,
      sortOrder: sortField === 'download_name' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      sorter: (a, b) => (a.download_name || '').localeCompare(b.download_name || '', 'zh'),
      render: (name: string) =>
        name ? <Text>{name}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '类型',
      dataIndex: 'ref_type',
      key: 'ref_type',
      width: 120,
      render: (t: string) => (
        <Tag color={t === 'lora' ? 'magenta' : 'gold'}>
          {t === 'lora' ? 'LoRA' : 'Checkpoint'}
        </Tag>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model_ids',
      key: 'model_ids',
      render: (ids: number[]) =>
        ids.length === 0 ? (
          <Text type="secondary">-</Text>
        ) : (
          ids.map((id) => modelMap.get(id) || `#${id}`).join('、')
        ),
    },
    {
      title: '链接',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) =>
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4f6bf0' }}
          >
            {url}
          </a>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      sortOrder: sortField === 'size' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      sorter: (a, b) => sizeValue(a.size) - sizeValue(b.size),
      render: (size: string) =>
        size ? <Text>{size}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (note: string) =>
        note ? <Text>{note}</Text> : null,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      sortOrder: sortField === 'created_at' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      render: (t: string) => <Text>{formatDateTime(t)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Space>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="container header-inner">
          <Space>
            <Link to="/">
              <Button type="text" icon={<ArrowLeftOutlined />} />
            </Link>
            <Title level={4} style={{ margin: 0 }}>
              model（共 {items.length} 条）
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
                style={{ width: 220 }}
                placeholder="搜索名称 / 下载名称"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                allowClear
              />
              <Select
                style={{ width: 140 }}
                value={typeFilter || undefined}
                onChange={(v) => setTypeFilter(v ?? '')}
                placeholder="全部类型"
                allowClear
                options={TYPE_OPTIONS}
              />
              <Select
                style={{ width: 160 }}
                value={modelFilter || undefined}
                onChange={(v) => setModelFilter(v ?? '')}
                placeholder="全部模型"
                allowClear
                options={models.map((m) => ({ label: m.name, value: m.id }))}
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
        ) : (
          <div style={{ paddingTop: 16 }}>
            <Table<ModelRef>
            dataSource={filtered}
            columns={columns}
            rowKey="id"
            size="middle"
            pagination={false}
            locale={{ emptyText: isFiltered ? '没有符合条件的 model' : '还没有 model' }}
            onChange={(_pagination, _filters, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              if (!s || !s.order) {
                setSortField('created_at');
                setSortOrder('desc');
                return;
              }
              setSortField((s.columnKey as SortField) ?? 'created_at');
              setSortOrder(s.order === 'ascend' ? 'asc' : 'desc');
            }}
          />
          </div>
        )}
      </main>

      <Modal
        title={editing ? '编辑 model' : '新增 model'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: '80px' }}
          wrapperCol={{ flex: 'auto' }}
          style={{ marginTop: 16 }}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={100} placeholder="如：detail_tweaker" />
          </Form.Item>
          <Form.Item label="下载名称" name="download_name" rules={[{ required: true, message: '请输入下载名称' }]}>
            <Input maxLength={200} placeholder="下载时的文件名" />
          </Form.Item>
          <Form.Item label="类型" name="ref_type" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="lora">LoRA</Radio>
              <Radio value="checkpoint">Checkpoint</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="模型" name="model_ids" rules={[{ required: true, message: '请选择关联的模型' }]}>
            <Select
              mode="multiple"
              placeholder="选择关联的模型（可多选）"
              options={models.map((m) => ({ label: m.name, value: m.id }))}
              optionFilterProp="label"
              showSearch
              allowClear
            />
          </Form.Item>
          <Form.Item label="链接" name="url">
            <Input maxLength={2000} placeholder="Civitai 等模型页面地址（可选）" />
          </Form.Item>
          <Form.Item label="大小" name="size">
            <Input maxLength={50} placeholder="如：1.2GB（可选）" />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea maxLength={500} placeholder="备注（可选）" autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
