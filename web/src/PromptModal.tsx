import { useMemo, useState } from 'react';
import { Modal, Input, Select, Radio, Switch, Button, Space, Tag as AntTag, Typography, App as AntApp } from 'antd';
import { ExpandAltOutlined, CopyOutlined } from '@ant-design/icons';
import type { Model, ModelRef, Prompt, PromptInput, PromptType, Source, Tag } from './api';
import { TYPE_LABELS, copyText } from './utils';

const { Text } = Typography;

const TYPE_OPTIONS: PromptType[] = ['t2i', 't2v', 'i2v'];

const REQUIRED_ASTERISK = <span style={{ color: '#ff4d4f', marginRight: 2 }}>*</span>;

interface Props {
  editing: Prompt | null;
  tags: Tag[];
  models: Model[];
  modelRefs: ModelRef[];
  sources: Source[];
  onClose: () => void;
  onSave: (data: PromptInput) => Promise<void>;
}

export function PromptModal({ editing, tags, models, modelRefs, sources, onClose, onSave }: Props) {
  const { message } = AntApp.useApp();
  const [title, setTitle] = useState(editing?.title ?? '');
  const [type, setType] = useState<PromptType>(editing?.type ?? 't2i');
  const [selectedTags, setSelectedTags] = useState<number[]>(editing?.tags ?? []);
  const [modelId, setModelId] = useState<number | null>(editing?.model_id ?? null);
  const [modelRefIds, setModelRefIds] = useState<number[]>(editing?.model_refs ?? []);
  const [sourceId, setSourceId] = useState<number | null>(editing?.source_id ?? null);
  const [url, setUrl] = useState(editing?.url ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [favorite, setFavorite] = useState(editing?.favorite ?? false);
  const [saving, setSaving] = useState(false);
  const [viewFull, setViewFull] = useState(false);
  const [copied, setCopied] = useState(false);

  const toggleTag = (id: number) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  // model 选项：须先选择模型，展示该模型关联的资源；未选/清空模型时为空
  const modelRefOptions = useMemo(() => {
    if (modelId == null) return [];
    const list = modelRefs.filter((r) => r.model_ids.includes(modelId));
    return [...list]
      .sort((a, b) => (a.download_name || a.name).localeCompare(b.download_name || b.name, 'zh'))
      .map((r) => ({ label: r.download_name || r.name, value: r.id, refType: r.ref_type }));
  }, [modelRefs, modelId]);

  // 切换/清空模型时，清掉不属于当前模型的已选项
  const handleModelChange = (v: number | null) => {
    setModelId(v ?? null);
    if (v == null) {
      setModelRefIds([]);
      return;
    }
    setModelRefIds((prev) =>
      prev.filter((id) => modelRefs.find((r) => r.id === id)?.model_ids.includes(v)),
    );
  };

  const handleCopy = async () => {
    if (await copyText(content)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const submit = async () => {
    if (saving) return;
    if (!title.trim()) return message.error('请填写标题');
    if (sourceId == null) return message.error('请选择来源');
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
        type,
        tags: selectedTags,
        model_id: modelId,
        model_refs: modelRefIds,
        source_id: sourceId,
        url: url.trim(),
        note: note.trim(),
        favorite,
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? '编辑提示词' : '新增提示词'}
      open
      onCancel={onClose}
      width={680}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="primary" onClick={submit} loading={saving}>
            保存
          </Button>
        </Space>
      }
    >
      <div className="prompt-form">
        <div className="form-row">
          <Text className="form-label">{REQUIRED_ASTERISK}标题</Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给这条提示词起个名字"
            maxLength={200}
          />
        </div>

        <div className="form-row">
          <Text className="form-label">{REQUIRED_ASTERISK}类型</Text>
          <Radio.Group value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((value) => (
              <Radio key={value} value={value}>
                {TYPE_LABELS[value]}
              </Radio>
            ))}
          </Radio.Group>
        </div>

        <div className="form-row">
          <Text className="form-label">模型</Text>
          <Select
            style={{ flex: 1 }}
            value={modelId ?? undefined}
            onChange={handleModelChange}
            placeholder="不指定模型"
            allowClear
            showSearch
            optionFilterProp="label"
            options={models.map((m) => ({ label: m.name, value: m.id }))}
          />
        </div>

        <div className="form-row">
          <Text className="form-label">{REQUIRED_ASTERISK}来源</Text>
          <Select
            style={{ flex: 1 }}
            value={sourceId ?? undefined}
            onChange={(v) => setSourceId(v ?? null)}
            placeholder="选择来源"
            allowClear
            showSearch
            optionFilterProp="label"
            options={sources.map((s) => ({ label: s.name, value: s.id }))}
          />
        </div>

        <div className="form-row">
          <Text className="form-label">链接</Text>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="提示词图片链接（可选）"
            maxLength={2000}
          />
        </div>

        <div className="form-row">
          <Text className="form-label">model</Text>
          <Select
            mode="multiple"
            style={{ flex: 1 }}
            value={modelRefIds}
            onChange={setModelRefIds}
            placeholder="选择关联的 model"
            showSearch
            optionFilterProp="label"
            options={modelRefOptions}
            optionRender={(option) => (
              <Space size={4}>
                <span>{option.data.label}</span>
                <AntTag color={option.data.refType === 'checkpoint' ? 'gold' : 'magenta'} style={{ marginRight: 0 }}>
                  {option.data.refType === 'checkpoint' ? 'Checkpoint' : 'LoRA'}
                </AntTag>
              </Space>
            )}
          />
        </div>

        <div className="form-row form-row-top">
          <Text className="form-label">标签</Text>
          <div className="tag-picker">
            {tags.length === 0 ? (
              <Text type="secondary">还没有可用标签</Text>
            ) : (
              <div className="tag-chips">
                {tags.map((tag) => (
                  <Button
                    key={tag.id}
                    size="small"
                    type={selectedTags.includes(tag.id) ? 'primary' : 'default'}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-row form-row-top">
          <Text className="form-label">提示词</Text>
          <div style={{ flex: 1, position: 'relative' }}>
            <Input.TextArea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴或输入提示词内容…"
              onClick={() => content.trim() && setViewFull(true)}
            />
            {content.trim() && (
              <Button
                type="text"
                size="small"
                icon={<ExpandAltOutlined />}
                onClick={() => setViewFull(true)}
                style={{ position: 'absolute', top: 4, right: 4, opacity: 0.6 }}
              />
            )}
          </div>
        </div>

        <div className="form-row form-row-top">
          <Text className="form-label">备注</Text>
          <Input.TextArea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="使用心得、参数等（可选）"
          />
        </div>

        <div className="form-row">
          <Text className="form-label">收藏</Text>
          <Switch checked={favorite} onChange={setFavorite} />
        </div>
      </div>

      <Modal
        title="提示词全文"
        open={viewFull}
        onCancel={() => setViewFull(false)}
        width={760}
        footer={
          <Space>
            <Button onClick={() => setViewFull(false)}>关闭</Button>
            <Button type="primary" icon={<CopyOutlined />} onClick={handleCopy}>
              {copied ? '已复制' : '复制提示词'}
            </Button>
          </Space>
        }
      >
        <pre className="full-text-view">{content}</pre>
      </Modal>
    </Modal>
  );
}
